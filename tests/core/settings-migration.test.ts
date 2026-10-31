import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../../src/core/default-settings.ts';
import {
  migrateStoredSettings,
  normalizeSettingsShape,
  withDerivedClassificationLists,
} from '../../src/core/settings-migration.ts';
import type { Settings } from '../../src/types/index.ts';

/** Build a Settings value from a loosely typed (possibly corrupt or legacy) stored object. */
function stored(overrides: Record<string, unknown>): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides } as unknown as Settings;
}

/** Stored settings as an old version wrote them: no item lists, only the legacy arrays. */
function legacy(overrides: Record<string, unknown>): Settings {
  return { ...overrides } as unknown as Settings;
}

describe('normalizeSettingsShape', () => {
  it('replaces missing or wrong-typed lists with copies of the defaults', () => {
    const out = normalizeSettingsShape(stored({
      restrictedPatterns: null,
      allowedPatterns: 'example.com',
      ignoredPatterns: undefined,
      categoryItems: {},
      safetyLevelItems: 5,
      notificationTypes: null,
      pageNotificationTypes: 'restricted',
    }));
    assert.deepEqual(out.restrictedPatterns, []);
    assert.deepEqual(out.allowedPatterns, []);
    assert.deepEqual(out.ignoredPatterns, []);
    assert.deepEqual(out.categoryItems, DEFAULT_SETTINGS.categoryItems);
    assert.deepEqual(out.safetyLevelItems, DEFAULT_SETTINGS.safetyLevelItems);
    assert.deepEqual(out.notificationTypes, DEFAULT_SETTINGS.notificationTypes);
    assert.deepEqual(out.pageNotificationTypes, DEFAULT_SETTINGS.pageNotificationTypes);
    assert.notEqual(out.categoryItems, DEFAULT_SETTINGS.categoryItems);
  });

  it('keeps valid lists, including empty ones', () => {
    const out = normalizeSettingsShape(stored({
      restrictedPatterns: ['a.com'],
      categoryItems: [],
      notificationTypes: [],
    }));
    assert.deepEqual(out.restrictedPatterns, ['a.com']);
    assert.deepEqual(out.categoryItems, []);
    assert.deepEqual(out.notificationTypes, []);
  });

  it('timeLimits: wrong or missing parts fall back to defaults, valid parts are kept', () => {
    const out = normalizeSettingsShape(stored({
      timeLimits: { enabled: 'yes', dailyLimitMinutes: 45, allowedHours: { start: 6, end: '22' } },
    }));
    assert.deepEqual(out.timeLimits, {
      enabled: DEFAULT_SETTINGS.timeLimits.enabled,
      dailyLimitMinutes: 45,
      allowedHours: { start: 6, end: DEFAULT_SETTINGS.timeLimits.allowedHours.end },
    });
  });

  it('timeLimits: null or absent becomes the defaults', () => {
    assert.deepEqual(normalizeSettingsShape(stored({ timeLimits: null })).timeLimits, DEFAULT_SETTINGS.timeLimits);
    assert.deepEqual(normalizeSettingsShape(stored({ timeLimits: undefined })).timeLimits, DEFAULT_SETTINGS.timeLimits);
  });

  it('leaves other fields alone and does not mutate its input', () => {
    const input = stored({ aiModel: 'm', telegramChatId: '7', restrictedPatterns: null });
    const out = normalizeSettingsShape(input);
    assert.equal(out.aiModel, 'm');
    assert.equal(out.telegramChatId, '7');
    assert.equal(input.restrictedPatterns, null);
    assert.notEqual(out, input);
  });

  it('is idempotent', () => {
    const once = normalizeSettingsShape(stored({ restrictedPatterns: null, timeLimits: { enabled: 1 } }));
    assert.deepEqual(normalizeSettingsShape(once), once);
  });
});

describe('migrateStoredSettings', () => {
  it('fills keys missing from storage with defaults and keeps what the user stored', () => {
    const out = migrateStoredSettings(legacy({ restrictedPatterns: ['a.com'], aiModel: 'm' }));
    assert.deepEqual(out.restrictedPatterns, ['a.com']);
    assert.equal(out.aiModel, 'm');
    assert.equal(out.restrictedPageMessage, DEFAULT_SETTINGS.restrictedPageMessage);
    assert.deepEqual(out.pageNotificationTypes, DEFAULT_SETTINGS.pageNotificationTypes);
  });

  it('legacy category lists become categoryItems (de-duplicated case-insensitively, restricted flag from the restricted list)', () => {
    const out = migrateStoredSettings(legacy({
      categoryItems: [],
      availableCategories: ['News', ' news ', 'Games'],
      restrictedCategories: ['games', 'Adult'],
    }));
    assert.deepEqual(out.categoryItems, [
      { name: 'News', restricted: false },
      { name: 'Games', restricted: true },
      { name: 'Adult', restricted: true },
    ]);
  });

  it('legacy safety-level lists become safetyLevelItems', () => {
    const out = migrateStoredSettings(legacy({
      safetyLevelItems: [],
      availableSafetyLevels: ['Low', 'High'],
      restrictedSafetyLevels: ['High'],
    }));
    assert.deepEqual(out.safetyLevelItems, [
      { name: 'Low', restricted: false },
      { name: 'High', restricted: true },
    ]);
  });

  it('existing non-empty items are never overwritten by legacy lists', () => {
    const items = [{ name: 'Only', restricted: true }];
    const out = migrateStoredSettings(legacy({
      categoryItems: items,
      availableCategories: ['Other'],
      restrictedCategories: [],
    }));
    assert.deepEqual(out.categoryItems, items);
  });

  it('a second run changes nothing', () => {
    const input = legacy({
      categoryItems: [],
      availableCategories: ['News', 'Games'],
      restrictedCategories: ['Games'],
      safetyLevelItems: [],
      availableSafetyLevels: ['Low', 'High'],
      restrictedSafetyLevels: ['High'],
      restrictedPatterns: null,
    });
    const once = migrateStoredSettings(input);
    assert.deepEqual(migrateStoredSettings(once), once);
  });

  it('current behaviour, see M5: legacy lists are ignored when the stored object has no categoryItems key at all', () => {
    // defaults are merged first, so categoryItems is already non-empty and the legacy lists never migrate
    const out = migrateStoredSettings(legacy({
      availableCategories: ['MyCategory'],
      restrictedCategories: ['MyCategory'],
    }));
    assert.deepEqual(out.categoryItems, DEFAULT_SETTINGS.categoryItems);
    assert.equal(out.categoryItems.some((i) => i.name === 'MyCategory'), false);
  });

  it('current behaviour, see M5: legacy arrays stay in the migrated settings next to the items', () => {
    const out = migrateStoredSettings(legacy({
      categoryItems: [],
      availableCategories: ['News'],
      restrictedCategories: [],
    }));
    assert.deepEqual(out.availableCategories, ['News']);
  });
});

describe('withDerivedClassificationLists', () => {
  it('derives available (all names) and restricted (flagged names) lists from the items', () => {
    const out = withDerivedClassificationLists(stored({
      categoryItems: [{ name: 'News', restricted: false }, { name: 'Games', restricted: true }],
      safetyLevelItems: [{ name: 'Low', restricted: false }, { name: 'High', restricted: true }],
    }));
    assert.deepEqual(out.availableCategories, ['News', 'Games']);
    assert.deepEqual(out.restrictedCategories, ['Games']);
    assert.deepEqual(out.availableSafetyLevels, ['Low', 'High']);
    assert.deepEqual(out.restrictedSafetyLevels, ['High']);
  });

  it('empty item lists leave the existing derived fields as they are', () => {
    const out = withDerivedClassificationLists(stored({
      categoryItems: [],
      safetyLevelItems: [],
      availableCategories: ['Kept'],
      restrictedSafetyLevels: ['Kept'],
    }));
    assert.deepEqual(out.availableCategories, ['Kept']);
    assert.deepEqual(out.restrictedSafetyLevels, ['Kept']);
    assert.equal(out.restrictedCategories, undefined);
  });

  it('current behaviour, see M5: non-empty items overwrite stored legacy lists', () => {
    const out = withDerivedClassificationLists(stored({
      categoryItems: [{ name: 'News', restricted: false }],
      availableCategories: ['Stale'],
      restrictedCategories: ['Stale'],
    }));
    assert.deepEqual(out.availableCategories, ['News']);
    assert.deepEqual(out.restrictedCategories, []);
  });

  it('does not mutate its input', () => {
    const input = stored({ categoryItems: [{ name: 'News', restricted: true }] });
    const out = withDerivedClassificationLists(input);
    assert.notEqual(out, input);
    assert.equal(input.availableCategories, undefined);
  });
});
