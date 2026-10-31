import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CATEGORY_ITEMS,
  DEFAULT_SAFETY_LEVEL_ITEMS,
} from '../../src/core/classification-defaults.ts';
import { matchesContentRestrictions, synthesizeReason } from '../../src/core/content-restrictions.ts';
import type { ClassificationResult } from '../../src/types/index.ts';

function cls(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return { isEducational: false, category: 'Other', reason: 'r', safetyLevel: 'Low', ...overrides };
}

const restrictedNames = (items: Array<{ name: string; restricted: boolean }>): string[] =>
  items.filter((i) => i.restricted).map((i) => i.name);

describe('matchesContentRestrictions', () => {
  it('a restricted category blocks, case-insensitively and ignoring surrounding spaces', () => {
    assert.equal(matchesContentRestrictions(cls({ category: 'Games' }), ['Games'], []), true);
    assert.equal(matchesContentRestrictions(cls({ category: 'games' }), ['GAMES'], []), true);
    assert.equal(matchesContentRestrictions(cls({ category: ' Games ' }), [' games'], []), true);
  });

  it('a restricted safety level blocks, case-insensitively', () => {
    assert.equal(matchesContentRestrictions(cls({ safetyLevel: 'High' }), [], ['High']), true);
    assert.equal(matchesContentRestrictions(cls({ safetyLevel: 'high' }), [], ['HIGH']), true);
  });

  it('either match is enough', () => {
    assert.equal(matchesContentRestrictions(cls({ category: 'Games', safetyLevel: 'Low' }), ['Games'], ['High']), true);
    assert.equal(matchesContentRestrictions(cls({ category: 'News', safetyLevel: 'High' }), ['Games'], ['High']), true);
  });

  it('neither matching -> not blocked', () => {
    assert.equal(matchesContentRestrictions(cls({ category: 'News', safetyLevel: 'Low' }), ['Games'], ['High']), false);
  });

  it('null and undefined classification -> not blocked', () => {
    assert.equal(matchesContentRestrictions(null, ['Games'], ['High']), false);
    assert.equal(matchesContentRestrictions(undefined, ['Games'], ['High']), false);
  });

  it('empty restricted lists block nothing', () => {
    assert.equal(matchesContentRestrictions(cls({ category: 'Games', safetyLevel: 'High' }), [], []), false);
  });

  it('a missing category or safety level never matches', () => {
    assert.equal(matchesContentRestrictions(cls({ category: '', safetyLevel: null }), ['Games'], ['High']), false);
    assert.equal(matchesContentRestrictions(cls({ safetyLevel: undefined }), [], ['']), false);
  });

  it('matching is exact, not by substring', () => {
    assert.equal(matchesContentRestrictions(cls({ category: 'Social' }), ['Social Media'], []), false);
    assert.equal(matchesContentRestrictions(cls({ safetyLevel: 'Higher' }), [], ['High']), false);
  });

  describe('with the default lists', () => {
    const defaultCategories = restrictedNames(DEFAULT_CATEGORY_ITEMS);
    const defaultLevels = restrictedNames(DEFAULT_SAFETY_LEVEL_ITEMS);

    it('Unknown does not block by default', () => {
      assert.equal(matchesContentRestrictions(cls({ category: 'Other', safetyLevel: 'Unknown' }), defaultCategories, defaultLevels), false);
    });

    it('Unknown blocks once that item is marked restricted', () => {
      const levels = DEFAULT_SAFETY_LEVEL_ITEMS.map((i) => ({ ...i, restricted: i.restricted || i.name === 'Unknown' }));
      assert.equal(
        matchesContentRestrictions(cls({ category: 'Other', safetyLevel: 'Unknown' }), defaultCategories, restrictedNames(levels)),
        true,
      );
    });

    it('Medium and High block by default', () => {
      for (const level of ['Medium', 'High']) {
        assert.equal(matchesContentRestrictions(cls({ safetyLevel: level }), defaultCategories, defaultLevels), true, level);
      }
      assert.equal(matchesContentRestrictions(cls({ safetyLevel: 'Low' }), defaultCategories, defaultLevels), false);
    });
  });
});

describe('synthesizeReason', () => {
  const lists = { restrictedCategories: ['Games'], restrictedSafetyLevels: ['High'] };

  it('category only', () => {
    assert.equal(
      synthesizeReason({ category: 'Games', safetyLevel: 'Low' }, lists),
      'Category "Games" is blocked in the settings.',
    );
  });

  it('safety level only', () => {
    assert.equal(
      synthesizeReason({ category: 'News', safetyLevel: 'High' }, lists),
      'Safety level "High" is blocked in the settings.',
    );
  });

  it('both: both sentences, category first', () => {
    assert.equal(
      synthesizeReason({ category: 'Games', safetyLevel: 'High' }, lists),
      'Category "Games" is blocked in the settings. Safety level "High" is blocked in the settings.',
    );
  });

  it('matches the lists case-insensitively but prints the classification\'s own text', () => {
    assert.equal(
      synthesizeReason({ category: 'games', safetyLevel: 'Low' }, { restrictedCategories: ['GAMES'], restrictedSafetyLevels: [] }),
      'Category "games" is blocked in the settings.',
    );
  });

  it('isAgeAppropriate === false appends the age-group sentence to a blocked reason', () => {
    assert.equal(
      synthesizeReason({ category: 'Games', safetyLevel: 'Low', isAgeAppropriate: false }, lists),
      'Category "Games" is blocked in the settings. The page may not be suitable for the selected age group.',
    );
    assert.equal(
      synthesizeReason({ category: 'Games', safetyLevel: 'High', isAgeAppropriate: false }, lists),
      'Category "Games" is blocked in the settings. Safety level "High" is blocked in the settings. The page may not be suitable for the selected age group.',
    );
  });

  it('true and null age appropriateness add nothing; the legacy ageAppropriate mirror is honoured', () => {
    const base = { category: 'Games', safetyLevel: 'Low' };
    assert.equal(synthesizeReason({ ...base, isAgeAppropriate: true }, lists), 'Category "Games" is blocked in the settings.');
    assert.equal(synthesizeReason({ ...base, isAgeAppropriate: null }, lists), 'Category "Games" is blocked in the settings.');
    assert.ok(synthesizeReason({ ...base, ageAppropriate: false }, lists).endsWith('age group.'));
  });

  it('not blocked -> a neutral classified-as sentence (no age suffix)', () => {
    assert.equal(
      synthesizeReason({ category: 'News', safetyLevel: 'Low' }, lists),
      'Classified as News (safety level: Low).',
    );
    assert.equal(
      synthesizeReason({ category: 'News', safetyLevel: 'Low', isAgeAppropriate: false }, lists),
      'Classified as News (safety level: Low).',
    );
  });

  it('is built from list names only: no text of the page can reach it', () => {
    // the function does not even take url/title; extra properties on the object must not leak either
    const hostile = {
      category: 'Games',
      safetyLevel: 'High',
      title: '*bold* _it_ [x](http://evil) `code`',
      url: 'https://evil.example/*_[',
    } as unknown as ClassificationResult;
    const out = synthesizeReason(hostile, lists);
    assert.equal(out.includes('evil'), false);
    assert.equal(out.includes('bold'), false);
    assert.equal(/[*_[\]`]/.test(out), false, out);
  });
});
