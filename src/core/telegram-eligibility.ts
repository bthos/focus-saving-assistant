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
