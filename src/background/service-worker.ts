/**
 * Background Service Worker for tracking navigation and restricting URLs
 * 
 * IMPORTANT: Service Workers in Chrome Extensions do not support ES modules directly.
 * A bundler (webpack/rollup) is needed or functions must be embedded directly.
 * Currently using imports for typing, but a bundler is needed for building.
 */

import { initializeSettings, getSettings } from '../utils/storage';
import { loadRestrictionRules } from './rules-manager';
import { handleBeforeNavigate, handleCompletedNavigation } from './navigation-handler';
import { setupMessageHandlers } from './message-handler';
import { handleHistoryStateUpdated } from './quiet-hours-handler';
import { runWeeklyReportCheck, ensureWeeklyReportAlarm } from './weekly-report-handler';
import { syncHistoryFromBrowser } from './history-sync-handler';
import { pollTelegramUpdates } from './telegram-commands';
import { recoverUnfinishedNotices } from './explanation-runner';
import { processNotificationQueue, discardNotificationQueue } from '../utils/telegram-notifier';
import { planNotificationFlush, isFlushAlarmCurrent } from '../core/notification-queue.ts';
import {
  ALARM_NAMES,
  HISTORY_SYNC_PERIOD_MINUTES,
  TELEGRAM_POLL_INTERVAL_MIN_MAX,
} from '../utils/constants.js';

/**
 * Schedule or clear Telegram poll alarm based on settings
 */
async function updateTelegramPollAlarm(): Promise<void> {
  const settings = await getSettings();
  const shouldPoll =
    settings.enableTelegramCommands &&
    !!settings.telegramBotToken?.trim() &&
    !!settings.telegramChatId?.trim();

  if (shouldPoll) {
    const interval = Math.max(
      0.5,
      Math.min(TELEGRAM_POLL_INTERVAL_MIN_MAX, settings.telegramPollIntervalMinutes || 1)
    );
    await chrome.alarms.create(ALARM_NAMES.TELEGRAM_POLL, { periodInMinutes: interval });
  } else {
    await chrome.alarms.clear(ALARM_NAMES.TELEGRAM_POLL);
  }
}

/**
 * Schedule or clear the hourly/daily notification flush alarm based on settings.
 * When periodic sending is off, the stored queue is discarded so it cannot go stale or send later.
 */
async function updateNotificationFlushAlarm(): Promise<void> {
  const settings = await getSettings();
  const plan = planNotificationFlush(settings);

  if (plan.mode === 'periodic') {
    // chrome.alarms.get resolves undefined when the alarm does not exist (typings say Alarm).
    const existing: chrome.alarms.Alarm | undefined = await chrome.alarms.get(ALARM_NAMES.NOTIFICATION_FLUSH);
    // Creating restarts the countdown; keep it running unless the period changed or it is gone.
    if (!isFlushAlarmCurrent(existing, plan.periodInMinutes)) {
      await chrome.alarms.create(ALARM_NAMES.NOTIFICATION_FLUSH, { periodInMinutes: plan.periodInMinutes });
    }
  } else {
    await chrome.alarms.clear(ALARM_NAMES.NOTIFICATION_FLUSH);
    await discardNotificationQueue();
  }
}

/**
 * Extension initialization
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Focus Saving Extension installed');
  await initializeSettings();
  await loadRestrictionRules();
  await syncHistoryFromBrowser();
  await updateTelegramPollAlarm();
  await updateNotificationFlushAlarm();

  // Set up periodic history sync
  chrome.alarms.create(ALARM_NAMES.SYNC_HISTORY, { periodInMinutes: HISTORY_SYNC_PERIOD_MINUTES });

  // Weekly report: hourly alarm + first due-check
  await ensureWeeklyReportAlarm();
  await runWeeklyReportCheck();
});

/**
 * Handle startup - sync history on browser startup
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('Focus Saving Extension startup');
  await updateNotificationFlushAlarm();
  await syncHistoryFromBrowser();
  // Alarms may not survive a browser restart
  await ensureWeeklyReportAlarm();
  await runWeeklyReportCheck();
});

/**
 * Handle alarms for periodic tasks
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAMES.SYNC_HISTORY) {
    await syncHistoryFromBrowser();
  } else if (alarm.name === ALARM_NAMES.TELEGRAM_POLL) {
    await pollTelegramUpdates();
  } else if (alarm.name === ALARM_NAMES.NOTIFICATION_FLUSH) {
    await processNotificationQueue(await getSettings());
  } else if (alarm.name === ALARM_NAMES.WEEKLY_REPORT_CHECK) {
    await runWeeklyReportCheck();
  }
});

/**
 * Handle settings changes
 */
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' && changes.settings) {
    await loadRestrictionRules();
    await updateTelegramPollAlarm();
    await updateNotificationFlushAlarm();
    // Enabling/disabling Telegram or the weekly checkbox takes effect immediately
    await runWeeklyReportCheck();
  }
});

// Set up navigation handlers
chrome.webNavigation.onBeforeNavigate.addListener(handleBeforeNavigate);
chrome.webNavigation.onCompleted.addListener(handleCompletedNavigation);
// Single-page apps change the URL without a real navigation (quiet hours)
chrome.webNavigation.onHistoryStateUpdated.addListener(handleHistoryStateUpdated);

// Set up message handlers
setupMessageHandlers();

// Runs on every worker wake: recreate a lost weekly alarm and check once when it was missing,
// so an ordinary wake costs one alarms.get.
void ensureWeeklyReportAlarm()
  .then((created) => (created ? runWeeklyReportCheck() : undefined))
  .catch((error) => console.error('Weekly report alarm setup failed:', error));

// Once per worker instance: finish Telegram notices that a stopped worker left in their "pending" layout.
void recoverUnfinishedNotices()
  .catch((error) => console.error('Notice recovery failed:', error));
