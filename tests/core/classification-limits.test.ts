import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CATEGORY_ITEMS,
  DEFAULT_SAFETY_LEVEL_ITEMS,
  type ClassificationItem,
} from '../../src/core/classification-defaults.ts';
import {
  cleanItemName,
  getClassificationLimitWarnings,
  normalizeClassificationItems,
  sanitizeItemDescription,
  selectItemsForModel,
  validateNewItem,
} from '../../src/core/classification-limits.ts';

const names = (...n: string[]): ClassificationItem[] => n.map((name) => ({ name, restricted: false }));
const numbered = (prefix: string, count: number): ClassificationItem[] =>
  names(...Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`));

describe('cleanItemName', () => {
  it('removes control characters', () => {
    assert.equal(cleanItemName('Ga\u0000mes\u0007'), 'Games');
    assert.equal(cleanItemName('\u007fA\u009fB\u001f'), 'AB');
  });

  it('collapses every whitespace run (space, tab, newline) to a single space', () => {
    assert.equal(cleanItemName('Social   Media'), 'Social Media');
    assert.equal(cleanItemName('Social\tMedia'), 'Social Media');
    assert.equal(cleanItemName('Social\n\n \tMedia'), 'Social Media');
  });

  it('trims', () => {
    assert.equal(cleanItemName('   Games  '), 'Games');
  });

  it('control-only and whitespace-only input become the empty string', () => {
    assert.equal(cleanItemName('\u0000\u0001'), '');
    assert.equal(cleanItemName(' \n\t '), '');
  });
});

describe('sanitizeItemDescription', () => {
  it('applies the name cleaning rules', () => {
    assert.equal(sanitizeItemDescription('  Sites\nabout\u0000 cats  '), 'Sites about cats');
  });

  it('cuts to 200 characters', () => {
    const out = sanitizeItemDescription('d'.repeat(250));
    assert.equal(out.length, 200);
  });

  it('keeps a 200-character description whole', () => {
    assert.equal(sanitizeItemDescription('d'.repeat(200)), 'd'.repeat(200));
  });
});

describe('validateNewItem', () => {
  it('returns the cleaned name when everything is fine', () => {
    assert.deepEqual(validateNewItem('  Online \n Shops ', [], 'category', 0), { ok: true, name: 'Online Shops' });
  });

  it('empty, whitespace-only and control-only names are rejected as empty', () => {
    for (const raw of ['', '   ', '\n\t', '\u0000\u0001\u007f']) {
      assert.deepEqual(validateNewItem(raw, [], 'category', 0), { ok: false, code: 'empty' }, JSON.stringify(raw));
    }
  });

  it('a 40-character name is accepted, 41 characters is too-long and is NOT truncated', () => {
    assert.deepEqual(validateNewItem('n'.repeat(40), [], 'category', 0), { ok: true, name: 'n'.repeat(40) });
    assert.deepEqual(validateNewItem('n'.repeat(41), [], 'category', 0), { ok: false, code: 'too-long' });
  });

  it('length is measured after cleaning', () => {
    const raw = ' ' + 'n'.repeat(40) + '\n\n   ';
    assert.deepEqual(validateNewItem(raw, [], 'safety', 0), { ok: true, name: 'n'.repeat(40) });
  });

  it('a case-insensitive duplicate is rejected', () => {
    assert.deepEqual(validateNewItem('games', ['Educational', 'Games'], 'category', 2), { ok: false, code: 'duplicate' });
    assert.deepEqual(validateNewItem('  GAMES ', ['Games'], 'category', 1), { ok: false, code: 'duplicate' });
  });

  it('the 40th category is accepted, the 41st is a limit error', () => {
    assert.deepEqual(validateNewItem('Fortieth', [], 'category', 39), { ok: true, name: 'Fortieth' });
    assert.deepEqual(validateNewItem('Forty first', [], 'category', 40), { ok: false, code: 'limit' });
  });

  it('the 10th safety level is accepted, the 11th is a limit error', () => {
    assert.deepEqual(validateNewItem('Tenth', [], 'safety', 9), { ok: true, name: 'Tenth' });
    assert.deepEqual(validateNewItem('Eleventh', [], 'safety', 10), { ok: false, code: 'limit' });
  });

  it('the category limit (40) does not apply to safety levels and vice versa', () => {
    assert.equal(validateNewItem('x', [], 'safety', 39).ok, false, '39 safety levels is already over 10');
    assert.equal(validateNewItem('x', [], 'category', 10).ok, true, '10 categories is far below 40');
  });
});

describe('normalizeClassificationItems', () => {
  it('keeps a 45-item list at 45 (the cap never deletes)', () => {
    const out = normalizeClassificationItems(numbered('Cat', 45));
    assert.equal(out.length, 45);
    assert.deepEqual(out.map((i) => i.name), numbered('Cat', 45).map((i) => i.name));
  });

  it('keeps an over-long name as stored (it is only skipped when sending)', () => {
    const long = 'L'.repeat(60);
    const out = normalizeClassificationItems([{ name: long, restricted: true }]);
    assert.deepEqual(out, [{ name: long, restricted: true }]);
  });

  it('drops entries that are not objects, have no string name or an empty cleaned name', () => {
    const out = normalizeClassificationItems([
      null,
      undefined,
      'Games',
      42,
      [],
      {},
      { restricted: true },
      { name: 5, restricted: true },
      { name: '   ', restricted: false },
      { name: '\u0000\u0001', restricted: false },
      { name: 'Valid', restricted: true },
    ]);
    assert.deepEqual(out, [{ name: 'Valid', restricted: true }]);
  });

  it('cleans names (control characters, whitespace runs, trim)', () => {
    const out = normalizeClassificationItems([{ name: '  Social \n  Media\u0000 ', restricted: true }]);
    assert.deepEqual(out, [{ name: 'Social Media', restricted: true }]);
  });

  it('removes case-insensitive duplicates, the first one wins (with its flag and description)', () => {
    const out = normalizeClassificationItems([
      { name: 'Games', restricted: true, description: 'first' },
      { name: 'games', restricted: false, description: 'second' },
      { name: ' GAMES ', restricted: false },
      { name: 'News', restricted: false },
    ]);
    assert.deepEqual(out, [
      { name: 'Games', restricted: true, description: 'first' },
      { name: 'News', restricted: false },
    ]);
  });

  it('sanitises descriptions and drops the property when it ends up empty', () => {
    const out = normalizeClassificationItems([
      { name: 'A', restricted: false, description: '  multi\nline \u0000text ' },
      { name: 'B', restricted: false, description: '   ' },
      { name: 'C', restricted: false, description: 7 },
      { name: 'D', restricted: false, description: 'x'.repeat(300) },
    ]);
    assert.equal(out[0].description, 'multi line text');
    assert.equal(Object.hasOwn(out[1], 'description'), false);
    assert.equal(Object.hasOwn(out[2], 'description'), false);
    assert.equal(out[3].description?.length, 200);
  });

  it('leaves a clean list unchanged and does not mutate its input', () => {
    const input = [
      { name: 'Games', restricted: true },
      { name: 'News', restricted: false, description: 'Only news' },
    ];
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = normalizeClassificationItems(input);
    assert.deepEqual(out, snapshot);
    assert.deepEqual(input, snapshot);
    assert.notEqual(out[0], input[0], 'returns copies');
  });

  it('is idempotent', () => {
    const once = normalizeClassificationItems([
      { name: ' a  b ', restricted: true, description: ' d ' },
      { name: 'A B', restricted: false },
      null,
    ]);
    assert.deepEqual(normalizeClassificationItems(once), once);
  });

  it('an empty list stays empty', () => {
    assert.deepEqual(normalizeClassificationItems([]), []);
  });
});

describe('selectItemsForModel', () => {
  it('returns the first 40 valid categories in list order', () => {
    const out = selectItemsForModel(numbered('Cat', 45), 'category');
    assert.equal(out.length, 40);
    assert.deepEqual(out.map((i) => i.name), numbered('Cat', 40).map((i) => i.name));
  });

  it('returns the first 10 valid safety levels in list order', () => {
    const out = selectItemsForModel(numbered('Level', 14), 'safety');
    assert.deepEqual(out.map((i) => i.name), numbered('Level', 10).map((i) => i.name));
  });

  it('skips over-long names without letting them use up a slot', () => {
    const list = names('Alpha', 'X'.repeat(41), 'Beta');
    assert.deepEqual(selectItemsForModel(list, 'category').map((i) => i.name), ['Alpha', 'Beta']);

    const tail = [...numbered('Cat', 39), ...names('Y'.repeat(50), 'Fortieth', 'Forty first')];
    const out = selectItemsForModel(tail, 'category').map((i) => i.name);
    assert.equal(out.length, 40);
    assert.equal(out[39], 'Fortieth');
    assert.equal(out.includes('Y'.repeat(50)), false);
  });

  it('skips blank names and case-insensitive duplicates (first wins)', () => {
    const list = names('Games', '  ', 'games', 'News');
    assert.deepEqual(selectItemsForModel(list, 'category').map((i) => i.name), ['Games', 'News']);
  });

  it('an empty list falls back to the built-in defaults, per kind', () => {
    assert.deepEqual(selectItemsForModel([], 'category').map((i) => i.name), DEFAULT_CATEGORY_ITEMS.map((i) => i.name));
    assert.deepEqual(selectItemsForModel([], 'safety').map((i) => i.name), DEFAULT_SAFETY_LEVEL_ITEMS.map((i) => i.name));
  });

  it('a list with no valid item also falls back to the defaults', () => {
    assert.deepEqual(
      selectItemsForModel(names('', ' \n', 'Z'.repeat(41)), 'safety').map((i) => i.name),
      DEFAULT_SAFETY_LEVEL_ITEMS.map((i) => i.name),
    );
  });

  it('keeps the description of a sent item and does not mutate the input', () => {
    const list: ClassificationItem[] = [{ name: 'Games', restricted: true, description: 'Arcades' }];
    const out = selectItemsForModel(list, 'category');
    assert.equal(out[0].description, 'Arcades');
    assert.deepEqual(list, [{ name: 'Games', restricted: true, description: 'Arcades' }]);
  });
});

describe('getClassificationLimitWarnings', () => {
  it('45 categories: one warning that names the count and the cap', () => {
    const warnings = getClassificationLimitWarnings(numbered('Cat', 45), 'category');
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('45'), warnings[0]);
    assert.ok(warnings[0].includes('40'), warnings[0]);
  });

  it('12 safety levels: warning names 12 and 10', () => {
    const warnings = getClassificationLimitWarnings(numbered('Level', 12), 'safety');
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('12') && warnings[0].includes('10'), warnings[0]);
  });

  it('one 41-character name: a names warning, no count warning', () => {
    const warnings = getClassificationLimitWarnings(names('Games', 'N'.repeat(41)), 'category');
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('longer than 40'), warnings[0]);
  });

  it('over the cap and over-long names: both warnings', () => {
    const list = [...numbered('Cat', 41), ...names('N'.repeat(41))];
    assert.equal(getClassificationLimitWarnings(list, 'category').length, 2);
  });

  it('exactly at the limits there is no warning', () => {
    assert.deepEqual(getClassificationLimitWarnings(numbered('Cat', 40), 'category'), []);
    assert.deepEqual(getClassificationLimitWarnings(numbered('Level', 10), 'safety'), []);
    assert.deepEqual(getClassificationLimitWarnings(names('N'.repeat(40)), 'category'), []);
  });

  it('the built-in lists produce no warning', () => {
    assert.deepEqual(getClassificationLimitWarnings(DEFAULT_CATEGORY_ITEMS, 'category'), []);
    assert.deepEqual(getClassificationLimitWarnings(DEFAULT_SAFETY_LEVEL_ITEMS, 'safety'), []);
  });

  it('an empty list produces no warning (its help line is a UI concern)', () => {
    assert.deepEqual(getClassificationLimitWarnings([], 'category'), []);
  });
});
