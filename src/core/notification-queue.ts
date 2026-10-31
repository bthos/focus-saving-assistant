/**
 * Pure logic for the hourly/daily Telegram notification queue (no storage, no chrome.*).
 *
 * "Suspicious" (non-educational) page notifications are queued when notificationFrequency is
 * 'hourly' or 'daily' and flushed as one grouped message by a recurring alarm.
 */

import type { ClassificationResult, Settings } from '../types/index.ts';
import { DEFAULT_SETTINGS } from './default-settings.ts';

/** Hard cap on stored queue items; the oldest are dropped first. */
export const NOTIFICATION_QUEUE_MAX_ITEMS = 500;

const FLUSH_PERIOD_MINUTES = { hourly: 60, daily: 24 * 60 } as const;

/** Payload of a queued 'suspicious' notification (what notifyAllowedPathTelegram queues). */
export interface SuspiciousNotificationData {
  url: string;
  title: string;
  classification: ClassificationResult;
  accessAllowed: boolean;
  accessReason: string;
}

export interface QueuedNotification {
  type: 'suspicious';
  data: SuspiciousNotificationData;
  timestamp: number;
}

export type NotificationFlushSettings = Pick<
  Settings,
  | 'enableTelegramNotifications'
  | 'telegramBotToken'
  | 'telegramChatId'
  | 'notificationFrequency'
  | 'notificationTypes'
  | 'pageNotificationTypes'
>;

/** 'periodic': keep a recurring flush alarm. 'off': no alarm, and a stored queue is stale. */
export type NotificationFlushPlan = { mode: 'periodic'; periodInMinutes: number } | { mode: 'off' };

/** Flush period for a frequency, or null when the frequency does not queue ('instant'). */
export function getFlushPeriodMinutes(
  frequency: Settings['notificationFrequency'] | undefined
): number | null {
  return frequency === 'hourly' || frequency === 'daily' ? FLUSH_PERIOD_MINUTES[frequency] : null;
}

/**
 * Decide whether queued suspicious notifications can be flushed under the current settings.
 * Same gates as the instant path: Telegram enabled, token + chat configured, 'suspicious'
 * notifications on, and non-educational page notifications on.
 */
export function planNotificationFlush(settings: NotificationFlushSettings): NotificationFlushPlan {
  const periodInMinutes = getFlushPeriodMinutes(settings.notificationFrequency);
  if (periodInMinutes === null) return { mode: 'off' };
  if (!settings.enableTelegramNotifications) return { mode: 'off' };
  if (!settings.telegramBotToken?.trim() || !settings.telegramChatId?.trim()) return { mode: 'off' };

  const notificationTypes = settings.notificationTypes ?? DEFAULT_SETTINGS.notificationTypes;
  const pageNotificationTypes = settings.pageNotificationTypes ?? DEFAULT_SETTINGS.pageNotificationTypes;
  if (!notificationTypes.includes('suspicious') || !pageNotificationTypes.includes('nonEducational')) {
    return { mode: 'off' };
  }
  return { mode: 'periodic', periodInMinutes };
}

/**
 * True when an existing alarm already repeats at the wanted period.
 * Re-creating an alarm restarts its countdown, so callers only create when this is false.
 */
export function isFlushAlarmCurrent(
  existing: { periodInMinutes?: number } | undefined,
  periodInMinutes: number
): boolean {
  return existing !== undefined && existing.periodInMinutes === periodInMinutes;
}

/** Shape check for one stored item: what the flush message reads must be present. */
function isQueuedNotification(value: unknown): value is QueuedNotification {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as { type?: unknown; data?: unknown; timestamp?: unknown };
  if (item.type !== 'suspicious' || typeof item.timestamp !== 'number' || !Number.isFinite(item.timestamp)) {
    return false;
  }
  if (typeof item.data !== 'object' || item.data === null) return false;
  const data = item.data as { url?: unknown; title?: unknown };
  return typeof data.url === 'string' && typeof data.title === 'string';
}

/** Stored value -> well-formed queue, capped to the newest maxItems. Anything else -> []. */
export function normalizeQueue(
  raw: unknown,
  maxItems: number = NOTIFICATION_QUEUE_MAX_ITEMS
): QueuedNotification[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isQueuedNotification).slice(-maxItems);
}

/**
 * Append one item and drop the oldest beyond maxItems. Timestamps stay strictly increasing
 * (even if the clock stalls or goes backwards) so they identify items in removeDelivered.
 */
export function enqueueNotification(
  queue: readonly QueuedNotification[],
  type: QueuedNotification['type'],
  data: SuspiciousNotificationData,
  now: number,
  maxItems: number = NOTIFICATION_QUEUE_MAX_ITEMS
): QueuedNotification[] {
  const last = queue.length > 0 ? queue[queue.length - 1].timestamp : -Infinity;
  const timestamp = Math.max(now, last + 1);
  return [...queue, { type, data, timestamp }].slice(-maxItems);
}

/** Queue left after a flush: items queued while the send was in flight survive. */
export function removeDelivered(
  current: readonly QueuedNotification[],
  delivered: readonly QueuedNotification[]
): QueuedNotification[] {
  const deliveredStamps = new Set(delivered.map((item) => item.timestamp));
  return current.filter((item) => !deliveredStamps.has(item.timestamp));
}
