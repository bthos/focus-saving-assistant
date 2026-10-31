import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isRestrictedSiteNotifyEligible } from '../../src/core/telegram-eligibility.ts';
import type { Settings } from '../../src/types/index.ts';

type EligibilitySettings = Pick<
  Settings,
  'enableTelegramNotifications' | 'telegramBotToken' | 'telegramChatId' | 'notificationTypes' | 'pageNotificationTypes'
>;

function eligible(overrides: Partial<EligibilitySettings> = {}): EligibilitySettings {
  return {
    enableTelegramNotifications: true,
    telegramBotToken: '123:abc',
    telegramChatId: '42',
    notificationTypes: ['restricted', 'suspicious', 'weekly', 'timeLimit'],
    pageNotificationTypes: ['restricted', 'nonEducational'],
    ...overrides,
  };
}

/** Settings as a half-migrated or hand-edited store can present them. */
function loose(overrides: Record<string, unknown>): EligibilitySettings {
  return { ...eligible(), ...overrides } as unknown as EligibilitySettings;
}

describe('isRestrictedSiteNotifyEligible (same guards as notifyRestrictedSite at HEAD)', () => {
  it('everything on -> eligible', () => {
    assert.equal(isRestrictedSiteNotifyEligible(eligible()), true);
  });

  it('Telegram notifications off -> not eligible', () => {
    assert.equal(isRestrictedSiteNotifyEligible(eligible({ enableTelegramNotifications: false })), false);
  });

  it("'restricted' missing from notificationTypes -> not eligible", () => {
    assert.equal(isRestrictedSiteNotifyEligible(eligible({ notificationTypes: ['suspicious', 'weekly'] })), false);
    assert.equal(isRestrictedSiteNotifyEligible(eligible({ notificationTypes: [] })), false);
  });

  it("'restricted' missing from pageNotificationTypes -> not eligible", () => {
    assert.equal(isRestrictedSiteNotifyEligible(eligible({ pageNotificationTypes: ['nonEducational'] })), false);
    assert.equal(isRestrictedSiteNotifyEligible(eligible({ pageNotificationTypes: [] })), false);
  });

  it('an empty token or chat id -> not eligible', () => {
    assert.equal(isRestrictedSiteNotifyEligible(eligible({ telegramBotToken: '' })), false);
    assert.equal(isRestrictedSiteNotifyEligible(eligible({ telegramChatId: '' })), false);
  });

  it('missing arrays use the defaults, which include restricted', () => {
    assert.equal(isRestrictedSiteNotifyEligible(loose({ notificationTypes: undefined })), true);
    assert.equal(isRestrictedSiteNotifyEligible(loose({ pageNotificationTypes: undefined })), true);
    assert.equal(isRestrictedSiteNotifyEligible(loose({ notificationTypes: null, pageNotificationTypes: null })), true);
  });

  it('a whitespace-only token or chat id counts as present, exactly as today', () => {
    assert.equal(isRestrictedSiteNotifyEligible(eligible({ telegramBotToken: '   ' })), true);
    assert.equal(isRestrictedSiteNotifyEligible(eligible({ telegramChatId: ' ' })), true);
  });

  it('other notification types do not matter, only restricted', () => {
    assert.equal(
      isRestrictedSiteNotifyEligible(eligible({ notificationTypes: ['restricted'], pageNotificationTypes: ['restricted'] })),
      true,
    );
  });
});
