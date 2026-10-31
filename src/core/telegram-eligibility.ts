/**
 * Whether a Telegram message of a given notification type may be sent (pure).
 * Whitespace-only token / chat id count as missing.
 */

import type { Settings } from '../types/index.ts';

export type TelegramEligibilitySettings = Pick<
  Settings,
  'enableTelegramNotifications' | 'telegramBotToken' | 'telegramChatId' | 'notificationTypes'
>;

export function isTelegramTypeEligible(
  settings: TelegramEligibilitySettings,
  type: 'weekly' | 'timeLimit'
): boolean {
  return (
    settings.enableTelegramNotifications === true &&
    !!settings.telegramBotToken?.trim() &&
    !!settings.telegramChatId?.trim() &&
    Array.isArray(settings.notificationTypes) &&
    settings.notificationTypes.includes(type)
  );
}

type RestrictedNotifySettings = Pick<
  Settings,
  'enableTelegramNotifications' | 'telegramBotToken' | 'telegramChatId' | 'notificationTypes' | 'pageNotificationTypes'
>;

export type RestrictedNotifyBlocker = 'disabled' | 'type-off' | 'page-type-off' | 'not-configured';

/**
 * First reason a restricted-site notice may not be sent, or null when it may (the guards of the
 * pre-two-stage notifyRestrictedSite, in the same order). A whitespace-only token counts as present.
 */
export function getRestrictedNotifyBlocker(settings: RestrictedNotifySettings): RestrictedNotifyBlocker | null {
  if (!settings.enableTelegramNotifications) return 'disabled';
  const notificationTypes = settings.notificationTypes || ['restricted', 'suspicious', 'weekly', 'timeLimit'];
  if (!notificationTypes.includes('restricted')) return 'type-off';
  const pageNotificationTypes = settings.pageNotificationTypes || ['restricted', 'nonEducational'];
  if (!pageNotificationTypes.includes('restricted')) return 'page-type-off';
  if (!settings.telegramBotToken || !settings.telegramChatId) return 'not-configured';
  return null;
}

export function isRestrictedSiteNotifyEligible(settings: RestrictedNotifySettings): boolean {
  return getRestrictedNotifyBlocker(settings) === null;
}
