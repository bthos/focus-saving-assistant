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

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Escapes special Markdown characters in text for Telegram Markdown
 * Only escapes characters that are actually special in Telegram Markdown:
 * _ * [ ] ( ) ~ `
 */
export function escapeMarkdown(text: string): string {
  // Escape only special Markdown characters used in Telegram Markdown
  return text
    .replace(/\_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\~/g, '\\~')
    .replace(/\`/g, '\\`');
}

/**
 * Truncates URL for display while preserving readability
 */
function truncateUrl(url: string, maxLength: number = 60): string {
  if (url.length <= maxLength) return url;
  return url.substring(0, maxLength - 3) + '...';
}

/**
 * Formats timestamp consistently across notifications
 * Format: YYYY-MM-DD hh:mm:ss
 */
function formatTimestamp(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Extracts hostname from URL for callback_data (max 64 bytes)
 */
function urlToCallbackData(url: string): string {
  try {
    const urlStr = url.includes('://') ? url : `https://${url}`;
    const hostname = new URL(urlStr).hostname?.replace(/^www\./i, '') || url;
    return hostname.length > 50 ? hostname.substring(0, 50) : hostname;
  } catch {
    return url.length > 50 ? url.substring(0, 50) : url;
  }
}

/**
 * Builds InlineKeyboardMarkup for add-to-list actions (callback_data max 64 bytes)
 */
function buildInlineKeyboardForUrl(url: string): { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const data = urlToCallbackData(url);
  return {
    inline_keyboard: [
      [
        { text: '➕ Add to Allowed', callback_data: `allow:${data}` },
        { text: '➕ Add to Restricted', callback_data: `restrict:${data}` },
      ],
      [{ text: '➕ Add to Ignored', callback_data: `ignore:${data}` }],
    ],
  };
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
    `   • Safety Level: ${escapeMarkdown(safetyLevel)}\n` +
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

/**
 * Single-line Markdown: *Access:* outcome + human-readable reaction reason (for Telegram).
 */
export function formatAccessOutcomeMarkdown(
  outcome: 'allowed' | 'blocked',
  reasonCode: string,
  matchedPattern?: string | null
): string {
  const esc = (s: string) => escapeMarkdown(s);
  if (outcome === 'allowed') {
    if (reasonCode === 'allowed') {
      return `*Access:* ✅ Allowed — ${esc('URL matches an entry on the allow list')}`;
    }
    if (reasonCode === 'permitted') {
      return `*Access:* ✅ Allowed — ${esc('No URL restriction matched; page permitted')}`;
    }
    return `*Access:* ✅ Allowed — ${esc(reasonCode)}`;
  }
  if (reasonCode === 'restricted') {
    const p = matchedPattern?.trim();
    const detail = p
      ? `URL matches restricted list (pattern: ${p})`
      : 'URL matches restricted list';
    return `*Access:* 🚫 Blocked — ${esc(detail)}`;
  }
  if (reasonCode === 'content-restricted') {
    return `*Access:* 🚫 Blocked — ${esc('Content restriction (category or safety level)')}`;
  }
  return `*Access:* 🚫 Blocked — ${esc(reasonCode)}`;
}

/**
 * Sends a message to Telegram
 */
export async function sendTelegramMessage(
  botToken: string, 
  chatId: string, 
  message: string, 
  parseMode: string = 'Markdown',
  replyMarkup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
): Promise<boolean> {
  if (!botToken || !chatId) {
    console.warn('Telegram bot token or chat ID not configured');
    return false;
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
      return false;
    }
    
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error sending Telegram message:', errorMessage);
    await addSystemLog('telegram', `Failed to send Telegram message: ${errorMessage}`);
    return false;
  }
}

const EMPTY_INLINE_KEYBOARD = JSON.stringify({ inline_keyboard: [] });

/**
 * Updates an existing chat message (e.g. after inline button action). Strips inline keyboard.
 * @see https://core.telegram.org/bots/api#editmessagetext
 */
export async function editTelegramMessageText(
  botToken: string,
  chatId: string | number,
  messageId: number,
  text: string,
  parseMode: string = 'Markdown'
): Promise<boolean> {
  if (!botToken || chatId === undefined || chatId === null || messageId == null) {
    return false;
  }
  try {
    const url = `${TELEGRAM_API_BASE}${botToken}/editMessageText`;
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: parseMode,
      reply_markup: EMPTY_INLINE_KEYBOARD,
    };
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let errDetail = `${response.status}`;
      try {
        const errJson = await response.json();
        if (errJson.description) errDetail = errJson.description;
      } catch {
        errDetail = await response.text();
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
};

/**
 * Sends a notification about a restricted site (optionally merged with AI classification + tab title).
 */
export async function notifyRestrictedSite(
  settings: Settings, 
  url: string, 
  reason: string, 
  matchedPattern?: string | null,
  extras?: RestrictedSiteNotifyExtras
): Promise<void> {
  if (!settings.enableTelegramNotifications) {
    console.log('Telegram notifications disabled');
    return;
  }
  
  // Check if restricted notifications are enabled
  const notificationTypes = settings.notificationTypes || ['restricted', 'suspicious', 'weekly', 'timeLimit'];
  if (!notificationTypes.includes('restricted')) {
    console.log('Restricted site notifications disabled');
    return;
  }
  
  // Check if restricted page notifications are enabled
  const pageNotificationTypes = settings.pageNotificationTypes || ['restricted', 'nonEducational'];
  if (!pageNotificationTypes.includes('restricted')) {
    console.log('Restricted page notifications disabled');
    return;
  }
  
  if (!settings.telegramBotToken || !settings.telegramChatId) {
    console.warn('Telegram bot token or chat ID not configured');
    return;
  }
  
  // For restricted sites, always send instant notification regardless of notificationFrequency
  // This ensures parents are immediately notified of restricted access attempts
  
  const userProfile = escapeMarkdown(settings.userProfileName || 'Unknown User');
  const displayUrl = escapeMarkdown(url);
  const displayReason = escapeMarkdown(reason === 'restricted' ? 'Site in restricted list' : reason);
  const displayPattern = matchedPattern ? escapeMarkdown(matchedPattern) : null;
  const cls = extras?.classification && !extras.classification.error ? extras.classification : null;
  const isEducational = cls ? (cls.isEducational ?? cls.educational ?? null) : null;
  const pageTitle = extras?.pageTitle ?? '';

  let message: string;
  if (cls) {
    let detectionLine = '';
    if (isEducational === false) {
      detectionLine = `*Detection:* Non-educational content\n`;
    } else if (isEducational === true) {
      detectionLine = `*Detection:* Educational content\n`;
    }
    message =
      `🚫 *Site Access Restricted* — *${userProfile}*\n\n` +
      detectionLine +
      `${formatAccessOutcomeMarkdown('blocked', reason, matchedPattern)}\n\n` +
      formatTitleUrlLines(pageTitle, url) +
      `📝 *Restriction:* ${displayReason}\n` +
      (displayPattern ? `🔍 *Pattern:* ${displayPattern}\n` : '') +
      `\n${buildClassificationDetailsMarkdown(cls)}` +
      `\n🕐 ${formatTimestamp()}`;
  } else {
    const locBlock = pageTitle.trim()
      ? formatTitleUrlLines(pageTitle, url)
      : `🔗 *URL:* ${displayUrl}\n`;
    message =
      `🚫 *Site Access Restricted* — *${userProfile}*\n\n` +
      `${formatAccessOutcomeMarkdown('blocked', reason, matchedPattern)}\n\n` +
      locBlock +
      `📝 *Reason:* ${displayReason}\n` +
      (displayPattern ? `🔍 *Pattern:* ${displayPattern}\n` : '') +
      `\n🕐 ${formatTimestamp()}`;
  }
  
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
    `🕐 ${formatTimestamp()}`;
  
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
    message += `\n🕐 ${formatTimestamp()}`;
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
        `\n🕐 ${formatTimestamp()}`;
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
  
  return await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);
}

/**
 * Sends the once-per-quiet-period notice that a site was blocked outside the allowed hours.
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
    `⏰ *Allowed hours:* ${formatHour(allowedHours.start)} – ${formatHour(allowedHours.end)}\n\n` +
    `Further attempts are blocked without notice until ${formatHour(allowedHours.start)}.\n\n` +
    `🕐 ${formatTimestamp()}`;

  return await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);
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
    `\n\n🕐 ${formatTimestamp()}`;

  const sent = await sendTelegramMessage(settings.telegramBotToken, settings.telegramChatId, message);
  if (!sent) {
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
