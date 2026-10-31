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
import { syncHistoryFromBrowser } from './history-sync-handler';
import { pollTelegramUpdates } from './telegram-commands';
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
 * Extension initialization
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Focus Saving Extension installed');
  await initializeSettings();
  await loadRestrictionRules();
  await syncHistoryFromBrowser();
  await updateTelegramPollAlarm();

  // Set up periodic history sync
  chrome.alarms.create(ALARM_NAMES.SYNC_HISTORY, { periodInMinutes: HISTORY_SYNC_PERIOD_MINUTES });
});

/**
 * Handle startup - sync history on browser startup
 */
chrome.runtime.onStartup.addListener(async () => {
  console.log('Focus Saving Extension startup');
  await syncHistoryFromBrowser();
});

/**
 * Handle alarms for periodic tasks
 */
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAMES.SYNC_HISTORY) {
    await syncHistoryFromBrowser();
  } else if (alarm.name === ALARM_NAMES.TELEGRAM_POLL) {
    await pollTelegramUpdates();
  }
});

/**
 * Handle settings changes
 */
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' && changes.settings) {
    await loadRestrictionRules();
    await updateTelegramPollAlarm();
  }
});

// Set up navigation handlers
chrome.webNavigation.onBeforeNavigate.addListener(handleBeforeNavigate);
chrome.webNavigation.onCompleted.addListener(handleCompletedNavigation);

// Set up message handlers
setupMessageHandlers();
