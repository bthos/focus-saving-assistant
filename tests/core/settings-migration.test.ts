import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../../src/core/default-settings.ts';
import {
  deriveAudience,
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
      timeLimits: { enabled: 'yes', allowedHours: { start: 6, end: '22' } },
    }));
    assert.deepEqual(out.timeLimits, {
      enabled: DEFAULT_SETTINGS.timeLimits.enabled,
      allowedHours: { start: 6, end: DEFAULT_SETTINGS.timeLimits.allowedHours.end },
    });
  });

  it('timeLimits: a stored dailyLimitMinutes (dropped daily limit) is removed, valid quiet-hours fields are kept', () => {
    const out = normalizeSettingsShape(stored({
      timeLimits: { enabled: true, dailyLimitMinutes: 90, allowedHours: { start: 22, end: 7 } },
    }));
    assert.deepEqual(out.timeLimits, { enabled: true, allowedHours: { start: 22, end: 7 } });
    assert.equal(Object.hasOwn(out.timeLimits, 'dailyLimitMinutes'), false);
  });

  it('timeLimits: allowedHours outside 0..23, fractional, non-numeric or null fall back per field to 8 / 22', () => {
    for (const bad of [-1, 24, 7.5, Number.NaN, Number.POSITIVE_INFINITY, '8', null, undefined, {}]) {
      const out = normalizeSettingsShape(stored({
        timeLimits: { enabled: true, allowedHours: { start: bad, end: bad } },
      }));
      assert.deepEqual(out.timeLimits.allowedHours, { start: 8, end: 22 }, `value ${String(bad)}`);
    }
    // each field falls back on its own
    const mixed = normalizeSettingsShape(stored({ timeLimits: { enabled: true, allowedHours: { start: 24, end: 5 } } }));
    assert.deepEqual(mixed.timeLimits.allowedHours, { start: 8, end: 5 });
  });

  it('timeLimits: the boundary hours 0 and 23 are valid and kept', () => {
    const out = normalizeSettingsShape(stored({ timeLimits: { enabled: false, allowedHours: { start: 0, end: 23 } } }));
    assert.deepEqual(out.timeLimits, { enabled: false, allowedHours: { start: 0, end: 23 } });
  });

  it('timeLimits: a non-boolean enabled becomes false', () => {
    for (const bad of [1, 0, 'true', null, undefined, {}]) {
      const out = normalizeSettingsShape(stored({ timeLimits: { enabled: bad, allowedHours: { start: 9, end: 21 } } }));
      assert.equal(out.timeLimits.enabled, false, `value ${String(bad)}`);
      assert.deepEqual(out.timeLimits.allowedHours, { start: 9, end: 21 });
    }
  });

  it('timeLimits: valid input comes back unchanged', () => {
    const valid = { enabled: true, allowedHours: { start: 22, end: 8 } };
    assert.deepEqual(normalizeSettingsShape(stored({ timeLimits: valid })).timeLimits, valid);
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

describe('quiet hours settings cleanup', () => {
  it('migrateStoredSettings drops dailyLimitMinutes from stored settings', () => {
    const out = migrateStoredSettings(legacy({
      timeLimits: { enabled: true, dailyLimitMinutes: 90, allowedHours: { start: 22, end: 7 } },
    }));
    assert.deepEqual(out.timeLimits, { enabled: true, allowedHours: { start: 22, end: 7 } });
    assert.equal(Object.hasOwn(out.timeLimits, 'dailyLimitMinutes'), false);
  });

  it('migrateStoredSettings gives defaults when timeLimits is missing from storage', () => {
    const out = migrateStoredSettings(legacy({}));
    assert.deepEqual(out.timeLimits, { enabled: false, allowedHours: { start: 8, end: 22 } });
  });

  it('DEFAULT_SETTINGS.timeLimits has no dailyLimitMinutes and keeps the 8 -> 22 window, disabled', () => {
    assert.equal('dailyLimitMinutes' in DEFAULT_SETTINGS.timeLimits, false);
    assert.deepEqual(DEFAULT_SETTINGS.timeLimits, { enabled: false, allowedHours: { start: 8, end: 22 } });
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

const STRICT_AUDIENCE = 'children; be strict: anything not clearly suitable counts as unsuitable';

describe('deriveAudience (opening sentence of the stored single-call prompt)', () => {
  const cases: Array<[string, string | undefined, string]> = [
    ['the 6-10 template', 'Evaluate if this site is suitable for children aged 6-10. URL: {url}, Title: {title}.', 'children aged 6-10'],
    ['the teens template', 'Classify content by educational value for teens aged 13-16. URL: {url}, Title: {title}.', 'teenagers aged 13-16'],
    ['the strict template', 'Determine if this content is exclusively educational and safe for children. URL: {url}.', STRICT_AUDIENCE],
    ['the default template', 'Classify if this URL/title is educational content suitable for children. URL: {url}, Title: {title}.', 'children'],
    ['a custom prompt', 'Is this page fine for my daughter? {url}', 'children'],
    ['an empty prompt', '', 'children'],
    ['no prompt', undefined, 'children'],
    ['leading whitespace is ignored', '  \n Evaluate if this site is suitable for children aged 6-10. URL: {url}', 'children aged 6-10'],
    ['the sentence in the middle does not count', 'Please. Evaluate if this site is suitable for children aged 6-10.', 'children'],
  ];
  for (const [label, prompt, expected] of cases) {
    it(`${label} -> ${expected}`, () => {
      assert.equal(deriveAudience(prompt), expected);
    });
  }
});

describe('migrateStoredSettings — two-stage settings (AC4)', () => {
  it('a legacy object keeps the generative settings byte for byte and gets the Stage 1 defaults', () => {
    const prompt = 'My own prompt about {url} and {title}.\nSecond line.';
    const out = migrateStoredSettings(
      legacy({ aiProvider: 'openrouter', aiModel: 'openai/gpt-4o-mini', aiApiToken: ' sk-keep ', aiClassificationPrompt: prompt }),
    );
    assert.equal(out.aiProvider, 'openrouter');
    assert.equal(out.aiModel, 'openai/gpt-4o-mini');
    assert.equal(out.aiApiToken, ' sk-keep ');
    assert.equal(out.aiClassificationPrompt, prompt);
    assert.equal(out.decisionEnabled, false);
    assert.equal(out.decisionModel, '');
    assert.equal(out.decisionApiToken, '');
    assert.equal(out.enableAIExplanation, true);
    assert.equal(out.aiExplanationPrompt, DEFAULT_SETTINGS.aiExplanationPrompt);
  });

  it('the default explanation prompt has the placeholders and no JSON instructions', () => {
    const p = DEFAULT_SETTINGS.aiExplanationPrompt;
    for (const placeholder of ['{audience}', '{url}', '{title}', '{category}', '{safetyLevel}']) {
      assert.ok(p.includes(placeholder), placeholder);
    }
    assert.equal(/json/i.test(p), false);
  });

  it('new defaults: decision stage off, audience "children", explanation on', () => {
    assert.equal(DEFAULT_SETTINGS.decisionEnabled, false);
    assert.equal(DEFAULT_SETTINGS.decisionApiToken, '');
    assert.equal(DEFAULT_SETTINGS.decisionModel, '');
    assert.equal(DEFAULT_SETTINGS.aiAudience, 'children');
    assert.equal(DEFAULT_SETTINGS.enableAIExplanation, true);
  });

  it('aiAudience is derived from the three legacy template openings, and "children" for anything else', () => {
    const derive = (aiClassificationPrompt: string) => migrateStoredSettings(legacy({ aiClassificationPrompt })).aiAudience;
    assert.equal(derive('Evaluate if this site is suitable for children aged 6-10. URL: {url}'), 'children aged 6-10');
    assert.equal(derive('Classify content by educational value for teens aged 13-16. URL: {url}'), 'teenagers aged 13-16');
    assert.equal(derive('Determine if this content is exclusively educational and safe for children. URL: {url}'), STRICT_AUDIENCE);
    assert.equal(derive('Totally custom prompt {url}'), 'children');
    assert.equal(migrateStoredSettings(legacy({})).aiAudience, 'children', 'no prompt stored at all');
  });

  it('a stored aiAudience is kept, even when the stored prompt would derive another one', () => {
    const out = migrateStoredSettings(
      legacy({ aiAudience: 'my niece, 8', aiClassificationPrompt: 'Evaluate if this site is suitable for children aged 6-10. URL: {url}' }),
    );
    assert.equal(out.aiAudience, 'my niece, 8');
  });

  it('the stored prompt text is never rewritten when the audience is derived', () => {
    const prompt = 'Evaluate if this site is suitable for children aged 6-10. URL: {url}, Title: {title}.';
    assert.equal(migrateStoredSettings(legacy({ aiClassificationPrompt: prompt })).aiClassificationPrompt, prompt);
  });

  it('running twice gives the same result (the derived audience is stable)', () => {
    const once = migrateStoredSettings(
      legacy({ aiClassificationPrompt: 'Classify content by educational value for teens aged 13-16. URL: {url}', restrictedPatterns: null }),
    );
    assert.equal(once.aiAudience, 'teenagers aged 13-16');
    assert.deepEqual(migrateStoredSettings(once), once);
  });

  it('wrong types are coerced field by field', () => {
    const out = migrateStoredSettings(
      legacy({
        decisionEnabled: 'yes',
        decisionApiToken: 7,
        decisionModel: null,
        aiAudience: 5,
        enableAIExplanation: 'no',
        aiExplanationPrompt: 12,
      }),
    );
    assert.equal(out.decisionEnabled, false);
    assert.equal(out.decisionApiToken, '');
    assert.equal(out.decisionModel, '');
    assert.equal(out.aiAudience, 'children');
    assert.equal(out.enableAIExplanation, true);
    assert.equal(out.aiExplanationPrompt, DEFAULT_SETTINGS.aiExplanationPrompt);
  });

  it('valid values of the new fields are kept', () => {
    const out = migrateStoredSettings(
      legacy({
        decisionEnabled: true,
        decisionApiToken: 'dec-key',
        decisionModel: 'liquid/d1.1-20261027',
        aiAudience: 'teenagers aged 13-16',
        enableAIExplanation: false,
        aiExplanationPrompt: 'Explain {url} to {audience}.',
      }),
    );
    assert.equal(out.decisionEnabled, true);
    assert.equal(out.decisionApiToken, 'dec-key');
    assert.equal(out.decisionModel, 'liquid/d1.1-20261027');
    assert.equal(out.aiAudience, 'teenagers aged 13-16');
    assert.equal(out.enableAIExplanation, false);
    assert.equal(out.aiExplanationPrompt, 'Explain {url} to {audience}.');
  });

  it('aiAudience is trimmed and cut to 200 characters', () => {
    assert.equal(migrateStoredSettings(legacy({ aiAudience: 'x'.repeat(300) })).aiAudience, 'x'.repeat(200));
    assert.equal(migrateStoredSettings(legacy({ aiAudience: '  teens  ' })).aiAudience, 'teens');
    assert.equal(migrateStoredSettings(legacy({ aiAudience: 'y'.repeat(200) })).aiAudience, 'y'.repeat(200));
  });

  it('does not mutate its input', () => {
    const input = legacy({ aiClassificationPrompt: 'Evaluate if this site is suitable for children aged 6-10.', categoryItems: [{ name: ' A  b ', restricted: true }] });
    const snapshot = JSON.parse(JSON.stringify(input));
    migrateStoredSettings(input);
    assert.deepEqual(input, snapshot);
  });

  it('normalizeSettingsShape coerces the same fields', () => {
    const out = normalizeSettingsShape(
      stored({ decisionEnabled: 1, decisionApiToken: {}, decisionModel: 3, aiAudience: '   ', enableAIExplanation: null, aiExplanationPrompt: '' }),
    );
    assert.equal(out.decisionEnabled, false);
    assert.equal(out.decisionApiToken, '');
    assert.equal(out.decisionModel, '');
    assert.equal(out.aiAudience, 'children');
    assert.equal(out.enableAIExplanation, true);
    assert.equal(out.aiExplanationPrompt, DEFAULT_SETTINGS.aiExplanationPrompt);
  });
});

describe('default lists are not migrated (AC44)', () => {
  const shopping = (items: Array<{ name: string; restricted: boolean }>) => items.find((i) => i.name === 'Shopping');

  it('new installs: Shopping is in the default restricted categories', () => {
    assert.equal(shopping(DEFAULT_SETTINGS.categoryItems)?.restricted, true);
    assert.equal(DEFAULT_SETTINGS.categoryItems.find((i) => i.name === 'Retail')?.restricted, true, 'Retail stays restricted');
  });

  it('a stored list with Shopping unrestricted keeps it unrestricted', () => {
    const items = [
      { name: 'Shopping', restricted: false },
      { name: 'Retail', restricted: true },
    ];
    const out = migrateStoredSettings(legacy({ categoryItems: items }));
    assert.deepEqual(out.categoryItems, items);
  });

  it('a stored full default list from an older install is not touched (Shopping stays unrestricted)', () => {
    const olderDefaults = DEFAULT_SETTINGS.categoryItems.map((i) => (i.name === 'Shopping' ? { ...i, restricted: false } : i));
    const out = migrateStoredSettings(legacy({ categoryItems: olderDefaults }));
    assert.equal(shopping(out.categoryItems)?.restricted, false);
    assert.deepEqual(out.categoryItems, olderDefaults);
  });

  it('legacy available/restricted arrays migrate exactly as before: Shopping is not added to restricted', () => {
    const out = migrateStoredSettings(
      legacy({ categoryItems: [], availableCategories: ['News', 'Shopping', 'Games'], restrictedCategories: ['Games'] }),
    );
    assert.deepEqual(out.categoryItems, [
      { name: 'News', restricted: false },
      { name: 'Shopping', restricted: false },
      { name: 'Games', restricted: true },
    ]);
    assert.deepEqual(out.availableCategories, ['News', 'Shopping', 'Games']);
    assert.deepEqual(out.restrictedCategories, ['Games']);
  });
});

describe('item lists survive normalisation (AC47)', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Cat ${i + 1}`, restricted: i % 2 === 0 }));

  it('a stored list of 45 categories is kept at 45 by normalizeSettingsShape and migrateStoredSettings', () => {
    const items = many(45);
    assert.equal(normalizeSettingsShape(stored({ categoryItems: items })).categoryItems.length, 45);
    const migrated = migrateStoredSettings(legacy({ categoryItems: items }));
    assert.deepEqual(migrated.categoryItems, items);
  });

  it('12 safety levels and over-long names are kept too (only sending is limited)', () => {
    const levels = Array.from({ length: 12 }, (_, i) => ({ name: `Level ${i + 1}`, restricted: false }));
    const longName = { name: 'L'.repeat(60), restricted: true };
    const out = normalizeSettingsShape(stored({ safetyLevelItems: levels, categoryItems: [longName] }));
    assert.equal(out.safetyLevelItems.length, 12);
    assert.deepEqual(out.categoryItems, [longName]);
  });

  it('an old export with 45 categories imports intact (defaults merged under it, then normalised)', () => {
    const exported = { aiProvider: 'github', categoryItems: many(45) };
    const imported = normalizeSettingsShape({ ...DEFAULT_SETTINGS, ...exported } as unknown as Settings);
    assert.deepEqual(imported.categoryItems, many(45));
  });

  it('invalid entries and case-insensitive duplicates are dropped, names are cleaned', () => {
    const out = migrateStoredSettings(
      legacy({
        categoryItems: [
          null,
          'Games',
          { restricted: true },
          { name: '   ', restricted: false },
          { name: '  Social \n Media\u0000 ', restricted: true },
          { name: 'social media', restricted: false },
          { name: 'News', restricted: false, description: '  Only  news \n' },
        ],
      }),
    );
    assert.deepEqual(out.categoryItems, [
      { name: 'Social Media', restricted: true },
      { name: 'News', restricted: false, description: 'Only news' },
    ]);
  });

  it('normalising twice changes nothing', () => {
    const once = normalizeSettingsShape(stored({ categoryItems: [{ name: ' a  b ', restricted: true }, { name: 'A B', restricted: false }, 3] }));
    assert.deepEqual(normalizeSettingsShape(once), once);
  });

  it('item descriptions in stored settings are kept', () => {
    const items = [{ name: 'Online Shops', restricted: true, description: 'Web shops that are not marketplaces' }];
    assert.deepEqual(migrateStoredSettings(legacy({ categoryItems: items })).categoryItems, items);
  });
});
