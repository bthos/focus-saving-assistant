/**
 * Constants used across the extension
 */

export const RESTRICTED_PAGE_PATH = '/pages/restricted.html';
export const MAX_HISTORY_ENTRIES = 10000;
export const MAX_LOG_ENTRIES = 100;
export const CLASSIFICATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
export const HISTORY_SYNC_PERIOD_MINUTES = 5;
export const HISTORY_SYNC_IGNORE_VISITS_SECONDS = 2;
export const TELEGRAM_POLL_INTERVAL_MIN_MAX = 60;

export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  HISTORY: 'history',
  CLASSIFICATION_CACHE: 'classificationCache',
  SYSTEM_LOGS: 'systemLogs',
  NOTIFICATION_QUEUE: 'notificationQueue',
  LAST_RESTRICTED_URL: 'lastRestrictedUrl',
  LAST_HISTORY_SYNC_TIME: 'lastHistorySyncTime',
  LAST_AI_ERROR: 'lastAIError',
  LAST_TELEGRAM_UPDATE_ID: 'lastTelegramUpdateId',
} as const;

export const MESSAGE_TYPES = {
  RELOAD_RULES: 'reloadRules',
  SYNC_HISTORY: 'syncHistory',
  CHECK_RESTRICTED: 'checkRestricted',
} as const;

export const ALARM_NAMES = {
  SYNC_HISTORY: 'syncHistory',
  TELEGRAM_POLL: 'telegramPoll',
  NOTIFICATION_FLUSH: 'notificationFlush',
} as const;
