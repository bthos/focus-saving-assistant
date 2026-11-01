/**
 * Sending notifications to Telegram via Bot API
 */

import { Settings, ClassificationResult } from '../types';
import { addSystemLog } from './system-logger';
import { STORAGE_KEYS } from './constants.js';
import {
  enqueueNotification,
  normalizeQueue,
  planNotificationFlush,
  removeDelivered,
  type QueuedNotification,
  type SuspiciousNotificationData,
} from '../core/notification-queue.ts';
import { formatHour, isQuietHoursNotifyEligible, type AllowedHours } from '../core/quiet-hours.ts';
import type { WeeklyStats } from '../core/weekly-report.ts';
import { escapeMarkdown } from '../core/telegram-markdown.ts';
import {
  buildBlockedSiteMessage,
  buildEditMessageBody,
  buildInlineKeyboardForUrl,
  formatAccessOutcomeMarkdown,
  formatTimestamp,
  isMessageNotModified,
  parseSendResult,
  toBlockedSiteMessageInput,
  type InlineKeyboard,
} from '../core/telegram-block-message.ts';
import { getRestrictedNotifyBlocker, type RestrictedNotifyBlocker } from '../core/telegram-eligibility.ts';

// telegram-commands.ts and the pages import these from here.
export { escapeMarkdown, formatAccessOutcomeMarkdown };

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Truncates URL for display while preserving readability
 */
function truncateUrl(url: string, maxLength: number = 60): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + '...';
}

/**
 * Markdown block: Classification Details + classifier reason (used in merged visit messages).
 */
function buildClassificationDetailsMarkdown(classification: ClassificationResult): string {
  const displayCategory = escapeMarkdown(classification.category || 'Unknown');
  const displayReason = escapeMarkdown(classification.reason || 'Not specified');
  const isEducational = classification.isEducational ?? classification.educational ?? null;
  const educationalStatus = isEducational !== null && isEducational !== undefined
    ? (isEducational ? 'Yes' : 'No')
    : 'Unknown';
  const isAgeAppropriate = classification.isAgeAppropriate ?? classification.ageAppropriate ?? null;
  const ageAppropriateStatus = isAgeAppropriate !== null && isAgeAppropriate !== undefined
    ? (isAgeAppropriate ? 'Yes' : 'No')
    : 'Not specified';
  const safetyLevel = classification.safetyLevel || 'Not specified';
  const suggestedResource = classification.suggestedUrl ?? classification.suggestedEducationalResource ?? null;
  const noUrlReason = classification.noUrlReason || null;

  let block = `📊 *Classification Details:*\n` +
    `   • Category: ${displayCategory}\n` +
    `   • Risk Level: ${escapeMarkdown(safetyLevel)}\n` +
    `   • Age Appropriate: ${ageAppropriateStatus}\n\n` +
    `   • Educational: ${educationalStatus}\n`;

  if (suggestedResource) {
    block += `   • Suggested Educational Resource: ${escapeMarkdown(suggestedResource)}\n`;
  } else {
    block += `   • Suggested Educational Resource: Not specified`;
    if (noUrlReason) {
      block += ` (${escapeMarkdown(noUrlReason)})`;
    }
    block += `\n`;
  }

  block += `\n📝 *Reason:*\n${displayReason}\n`;
  return block;
}

function formatTitleUrlLines(title: string, url: string): string {
  const displayTitle = escapeMarkdown(title || 'Not specified');
  const displayUrl = escapeMarkdown(url);
  return `📄 *Title:* ${displayTitle === 'Not specified' ? '_Not specified_' : displayTitle}\n` +
    `🔗 *URL:* ${displayUrl}\n`;
}

/** Where a sent message went: the target chat and the message id (null when the response had none). */
export type TelegramSendResult = { chatId: string; messageId: number | null };

/**
 * Sends a message to Telegram.
 * Resolves the send result (messageId is null if Telegram accepted the message but the response could not be read),
 * or null when the send failed.
 */
export async function sendTelegramMessage(
  botToken: string, 
  chatId: string, 
  message: string, 
  parseMode: string = 'Markdown',
  replyMarkup?: InlineKeyboard
): Promise<TelegramSendResult | null> {
  if (!botToken || !chatId) {
    console.warn('Telegram bot token or chat ID not configured');
    return null;
  }
  
  try {
    const url = `${TELEGRAM_API_BASE}${botToken}/sendMessage`;
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: message,
      parse_mode: parseMode,
      disable_web_page_preview: false,
    };
    if (replyMarkup) {
      body.reply_markup = JSON.stringify(replyMarkup);
    }
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    
    if (!response.ok) {
      let errorMessage = `Telegram API error: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.description) {
          errorMessage = `Telegram API error: ${errorData.description}`;
        } else if (errorData.error_code) {
          errorMessage = `Telegram API error ${errorData.error_code}: ${errorData.description || 'Unknown error'}`;
        } else if (typeof errorData === 'object') {
          errorMessage = `Telegram API error: ${JSON.stringify(errorData)}`;
        } else {
          errorMessage = `Telegram API error: ${String(errorData)}`;
        }
      } catch (e) {
        const errorText = await response.text();
        errorMessage = errorText ? `Telegram API error: ${errorText}` : `Telegram API error: ${response.status}`;
      }
      console.error(errorMessage);
      await addSystemLog('telegram', errorMessage);
      return null;
    }
    
    // The message is delivered at this point; an unreadable body only costs us the message id.
    const bodyText = await response.text().catch(() => '');
    return { chatId: String(chatId), messageId: parseSendResult(bodyText).messageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error sending Telegram message:', errorMessage);
    await addSystemLog('telegram', `Failed to send Telegram message: ${errorMessage}`);
    return null;
  }
}

/**
 * Updates an existing chat message. The inline keyboard is replaced by `replyMarkup`; without it the keyboard
 * is stripped (button presses in telegram-commands.ts). Telegram's "message is not modified" answer counts as success,
 * so repeating an edit with identical content is harmless.
 * @see https://core.telegram.org/bots/api#editmessagetext
 */
export async function editTelegramMessageText(
  botToken: string,
  chatId: string | number,
  messageId: number,
  text: string,
  parseMode: string = 'Markdown',
  replyMarkup?: InlineKeyboard
): Promise<boolean> {
  if (!botToken || chatId === undefined || chatId === null || messageId == null) {
    return false;
  }
  try {
    const url = `${TELEGRAM_API_BASE}${botToken}/editMessageText`;
    const body = buildEditMessageBody(chatId, messageId, text, parseMode, replyMarkup);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      let errDetail = errText || `${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        if (errJson?.description) errDetail = errJson.description;
      } catch {
        // not JSON: keep the raw body
      }
      if (response.status === 400 && isMessageNotModified(errDetail)) {
        console.log('editMessageText: message already has this content');
        return true;
      }
      console.warn('editMessageText failed:', errDetail);
      await addSystemLog('telegram', `editMessageText failed: ${errDetail}`);
      return false;
    }
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn('editMessageText error:', msg);
    await addSystemLog('telegram', `editMessageText error: ${msg}`);
    return false;
  }
}

export type RestrictedSiteNotifyExtras = {
  classification?: ClassificationResult | null;
  pageTitle?: string;
  /** 'pending': this block event owns Stage 2, so the first message carries the pending paragraph and is edited later. */
  explanation?: 'pending';
  /** Timestamp shown in the message; defaults to now. The later edit reuses the first message's value. */
  sentAt?: number;
};

const RESTRICTED_NOTIFY_SKIPPED: Record<RestrictedNotifyBlocker, string> = {
  disabled: 'Telegram notifications disabled',
  'type-off': 'Restricted site notifications disabled',
  'page-type-off': 'Restricted page notifications disabled',
  'not-configured': 'Telegram bot token or chat ID not configured',
};

/**
 * Sends a notification about a restricted site (optionally merged with AI classification + tab title).
 * Resolves the send result (see sendTelegramMessage), or null when nothing was sent.
 */
export async function notifyRestrictedSite(
  settings: Settings, 
  url: string, 
  reason: string, 
  matchedPattern?: string | null,
  extras?: RestrictedSiteNotifyExtras
): Promise<TelegramSendResult | null> {
  const blocker = getRestrictedNotifyBlocker(settings);
  if (blocker) {
    console.log(RESTRICTED_NOTIFY_SKIPPED[blocker]);
    return null;
  }
  
  // For restricted sites, always send instant notification regardless of notificationFrequency
  // This ensures parents are immediately notified of restricted access attempts
  
  const message = buildBlockedSiteMessage(toBlockedSiteMessageInput(settings, {
    url,
    reason,
    matchedPattern,
    pageTitle: extras?.pageTitle,
    classification: extras?.classification,
    pending: extras?.explanation === 'pending',
    sentAt: extras?.sentAt ?? Date.now(),
  }));
  
  console.log('Sending Telegram notification for restricted site:', url);
  const replyMarkup = settings.enableTelegramCommands
    ? buildInlineKeyboardForUrl(url)
    : undefined;
  const result = await sendTelegramMessage(
    settings.telegramBotToken,
    settings.telegramChatId,
    message,
    'Markdown',
    replyMarkup
  );
  
  if (result) {
    console.log('Telegram notification sent successfully');
  } else {
    console.error('Failed to send Telegram notification');
  }
  return result;
}

/**
 * Sends a notification about an allowed page being opened
 */
export async function notifyAllowedPage(
  settings: Settings,
  url: string,
  title: string,
  accessReason?: string
): Promise<void> {
  if (!settings.enableTelegramNotifications || !settings.telegramBotToken || !settings.telegramChatId) {
    return;
  }
  
  // Check if allowed page notifications are enabled
  const pageNotificationTypes = settings.pageNotificationTypes || ['restricted', 'nonEducational'];
  if (!pageNotificationTypes.includes('allowed')) {
    return;
  }
  
  const userProfile = escapeMarkdown(settings.userProfileName || 'Unknown User');
  const displayUrl = escapeMarkdown(url);
  const displayTitle = escapeMarkdown(title || 'Not specified');
  
  const accessLine = accessReason !== undefined
    ? `${formatAccessOutcomeMarkdown('allowed', accessReason)}\n\n`
    : '';
  const message = `✅ *Allowed page opened* — *${userProfile}*\n\n` +
    accessLine +
    `📄 *Title:* ${displayTitle === 'Not specified' ? '_Not specified_' : displayTitle}\n` +
    `🔗 *URL:* ${displayUrl}\n\n` +
    `🕐 ${formatTimestamp(Date.now())}`;
  
  await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);
}

/**
 * After navigation: single Telegram for "what we detected" + "access allowed" (merged).
 * Call only when checkUrl indicates the page is allowed.
 */
export async function notifyAllowedPathTelegram(
  settings: Settings,
  url: string,
  title: string,
  classification: ClassificationResult | null,
  accessReason: string = 'allowed'
): Promise<void> {
  if (!settings.enableTelegramNotifications || !settings.telegramBotToken || !settings.telegramChatId) {
    return;
  }

  const pageNotificationTypes = settings.pageNotificationTypes || ['restricted', 'nonEducational'];
  const notificationTypes = settings.notificationTypes || ['restricted', 'suspicious', 'weekly', 'timeLimit'];

  if (!classification || classification.error) {
    if (pageNotificationTypes.includes('allowed')) {
      await notifyAllowedPage(settings, url, title, accessReason);
    }
    return;
  }

  const isEducational = classification.isEducational ?? classification.educational ?? null;
  const userProfile = escapeMarkdown(settings.userProfileName || 'Unknown User');

  if (isEducational === true) {
    const eduOn = pageNotificationTypes.includes('educational');
    const allowedOn = pageNotificationTypes.includes('allowed');
    if (!eduOn && !allowedOn) {
      return;
    }
    if (!eduOn && allowedOn) {
      await notifyAllowedPage(settings, url, title, accessReason);
      return;
    }

    let message = `📚 *Educational page opened* — *${userProfile}*\n\n`;
    if (allowedOn) {
      message += `${formatAccessOutcomeMarkdown('allowed', accessReason)}\n\n`;
    }
    message += formatTitleUrlLines(title, url);
    if (eduOn) {
      message += `\n${buildClassificationDetailsMarkdown(classification)}`;
    }
    message += `\n🕐 ${formatTimestamp(Date.now())}`;
    await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);
    return;
  }

  if (isEducational === false) {
    const suspiciousOn = notificationTypes.includes('suspicious') && pageNotificationTypes.includes('nonEducational');
    const allowedOn = pageNotificationTypes.includes('allowed');
    if (!suspiciousOn && !allowedOn) {
      return;
    }

    const periodic = settings.notificationFrequency === 'daily' || settings.notificationFrequency === 'hourly';
    if (periodic && suspiciousOn) {
      await queueNotification('suspicious', {
        url,
        title,
        classification,
        accessAllowed: allowedOn,
        accessReason,
      });
      return;
    }

    if (suspiciousOn) {
      let message = `⚠️ *Non-educational content detected* — *${userProfile}*\n\n`;
      if (allowedOn) {
        message += `${formatAccessOutcomeMarkdown('allowed', accessReason)}\n\n`;
      }
      message += formatTitleUrlLines(title, url) +
        `\n${buildClassificationDetailsMarkdown(classification)}` +
        `\n🕐 ${formatTimestamp(Date.now())}`;
      const replyMarkup = settings.enableTelegramCommands
        ? buildInlineKeyboardForUrl(url)
        : undefined;
      await sendTelegramMessage(
        settings.telegramBotToken,
        settings.telegramChatId,
        message,
        'Markdown',
        replyMarkup
      );
      return;
    }

    if (allowedOn) {
      await notifyAllowedPage(settings, url, title, accessReason);
    }
    return;
  }

  if (pageNotificationTypes.includes('allowed')) {
    await notifyAllowedPage(settings, url, title, accessReason);
  }
}

/**
 * Sends a weekly report. Resolves true only if Telegram accepted the message.
 */
export async function sendWeeklyReport(settings: Settings, stats: WeeklyStats): Promise<boolean> {
  if (!settings.enableTelegramNotifications || !settings.telegramBotToken || !settings.telegramChatId) {
    return false;
  }
  
  // Check if weekly report notifications are enabled
  const notificationTypes = settings.notificationTypes || ['restricted', 'suspicious', 'weekly', 'timeLimit'];
  if (!notificationTypes.includes('weekly')) {
    console.log('Weekly report notifications disabled');
    return false;
  }
  
  const userProfile = escapeMarkdown(settings.userProfileName || 'Unknown User');
  const topCategories = stats.topCategories.length > 0 
    ? escapeMarkdown(stats.topCategories.join(', ')) 
    : 'None';
  
  // Format the message with better visual hierarchy
  const message = `📊 *Weekly Report*\n\n` +
    `👤 *User:* ${userProfile}\n\n` +
    `📈 *Statistics:*\n` +
    `   • Total visits: *${stats.totalVisits}*\n` +
    `   • Educational: *${stats.educationalVisits}* (${stats.educationalPercentage}%)\n` +
    `   • Restricted attempts: *${stats.restrictedAttempts}*\n\n` +
    `🏷️ *Top categories:* ${topCategories}\n\n` +
    `📅 *Period:* ${escapeMarkdown(stats.periodStart)} - ${escapeMarkdown(stats.periodEnd)}`;
  
  return (await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message)) !== null;
}

/**
 * Sends the once-per-quiet-period notice that a site was blocked during quiet hours.
 * Hostname only (no path, query or title). Resolves true only if Telegram accepted the message.
 */
export async function notifyQuietHoursAttempt(
  settings: Settings,
  url: string,
  allowedHours: AllowedHours
): Promise<boolean> {
  if (!isQuietHoursNotifyEligible(settings)) {
    return false;
  }

  let host: string;
  try {
    host = new URL(url).hostname.replace(/`/g, '') || 'unknown site';
  } catch {
    host = 'unknown site';
  }

  const userProfile = escapeMarkdown(settings.userProfileName || 'Unknown User');
  const message = `🌙 *Quiet Hours — Access Blocked*\n\n` +
    `👤 *User:* ${userProfile}\n` +
    `🌐 *Site:* \`${host}\`\n` +
    `⏰ *Quiet hours:* ${formatHour(allowedHours.end)} – ${formatHour(allowedHours.start)}\n\n` +
    `Further attempts are blocked without notice until ${formatHour(allowedHours.start)}.\n\n` +
    `🕐 ${formatTimestamp(Date.now())}`;

  return (await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message)) !== null;
}

/**
 * Notification queue for periodic (hourly/daily) sending
 */

// Queue read-modify-write steps run one at a time so concurrent calls cannot overwrite each other.
let queueMutation: Promise<unknown> = Promise.resolve();

function withQueueLock<T>(task: () => Promise<T>): Promise<T> {
  const run = queueMutation.then(task);
  queueMutation = run.catch(() => undefined);
  return run;
}

async function readNotificationQueue(): Promise<QueuedNotification[]> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.NOTIFICATION_QUEUE]);
  return normalizeQueue(stored[STORAGE_KEYS.NOTIFICATION_QUEUE]);
}

export async function queueNotification(
  type: QueuedNotification['type'],
  data: SuspiciousNotificationData
): Promise<void> {
  await withQueueLock(async () => {
    const queue = await readNotificationQueue();
    await chrome.storage.local.set({
      [STORAGE_KEYS.NOTIFICATION_QUEUE]: enqueueNotification(queue, type, data, Date.now()),
    });
  });
}

/**
 * Drops every stored queued notification (periodic sending is off, so they would only go stale).
 */
export async function discardNotificationQueue(): Promise<void> {
  await withQueueLock(() => chrome.storage.local.remove(STORAGE_KEYS.NOTIFICATION_QUEUE));
}

/**
 * Sends the queued notifications as one grouped message. The queue is cleared only after Telegram
 * accepted the message; on failure it is kept and the next flush retries.
 */
export async function processNotificationQueue(settings: Settings): Promise<void> {
  // Periodic sending not allowed under the current settings (instant, Telegram off, token/chat
  // missing, 'suspicious' off): stored items are stale, so drop them instead of sending.
  if (planNotificationFlush(settings).mode === 'off') {
    await discardNotificationQueue();
    return;
  }

  const items = await withQueueLock(readNotificationQueue);
  if (items.length === 0) {
    return;
  }

  const userProfileEscaped = escapeMarkdown(settings.userProfileName || 'Unknown User');
  const message = `⚠️ *${items.length} non-educational sites detected* — *${userProfileEscaped}*\n\n` +
    `📋 *Sites:*\n` +
    items.slice(0, 10).map((item, index) => {
      const displayUrl = truncateUrl(item.data.url, 50);
      const displayTitle = item.data.title ? escapeMarkdown(item.data.title) : '_No title_';
      const accessNote =
        item.data.accessAllowed === true
          ? `\n   ${formatAccessOutcomeMarkdown('allowed', item.data.accessReason || 'allowed')}`
          : '';
      return `${index + 1}. ${displayTitle}\n   \`${displayUrl}\`${accessNote}`;
    }).join('\n\n') +
    (items.length > 10 ? `\n\n... and *${items.length - 10}* more sites` : '') +
    `\n\n🕐 ${formatTimestamp(Date.now())}`;

  const sent = await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);
  if (sent === null) {
    return;
  }

  // Remove only what was sent: items queued while the message was in flight stay for the next flush.
  await withQueueLock(async () => {
    const current = await readNotificationQueue();
    await chrome.storage.local.set({
      [STORAGE_KEYS.NOTIFICATION_QUEUE]: removeDelivered(current, items),
    });
  });
}
