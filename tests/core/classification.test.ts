import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  fallbackClassificationFromText,
  isClassificationUseful,
  normalizeToList,
  parseModelReply,
  type ModelReplyContext,
} from '../../src/core/classification.ts';
import type { ClassificationResult } from '../../src/types/index.ts';

const CATEGORIES = ['Educational', 'Games', 'News', 'Other'];
const SAFETY_LEVELS = ['Low', 'High', 'Unknown'];

const CTX: ModelReplyContext = {
  url: 'https://example.com/page',
  title: 'Example page',
  model: 'actual-model',
  now: 1_700_000_000_000,
  availableCategories: CATEGORIES,
  availableSafetyLevels: SAFETY_LEVELS,
};

function parsedClassification(content: string, ctx: ModelReplyContext = CTX): ClassificationResult {
  const reply = parseModelReply(content, ctx);
  assert.equal(reply.kind, 'parsed', `expected a parsed reply, got ${reply.kind}`);
  return reply.kind === 'parsed' ? reply.classification : assert.fail('unreachable');
}

describe('normalizeToList', () => {
  it('returns the list spelling for a case-insensitive, trimmed match', () => {
    assert.equal(normalizeToList('  educational ', CATEGORIES, 'Other'), 'Educational');
    assert.equal(normalizeToList('GAMES', CATEGORIES, 'Other'), 'Games');
  });

  it('returns the fallback for values not in the list', () => {
    assert.equal(normalizeToList('Cooking', CATEGORIES, 'Other'), 'Other');
  });

  it('returns the fallback for empty, whitespace-only or nullish values', () => {
    assert.equal(normalizeToList('', CATEGORIES, 'Other'), 'Other');
    assert.equal(normalizeToList('   ', CATEGORIES, 'Other'), 'Other');
    assert.equal(normalizeToList(undefined as unknown as string, CATEGORIES, 'Other'), 'Other');
  });

  it('accepts any non-empty value (trimmed) when the allowed list is empty', () => {
    assert.equal(normalizeToList('  Cooking ', [], 'Other'), 'Cooking');
  });
});

describe('parseModelReply', () => {
  describe('well-formed replies', () => {
    it('maps a plain JSON reply and stamps url, title, model and time from the context', () => {
      const c = parsedClassification(JSON.stringify({
        isEducational: false,
        category: 'Games',
        reason: 'It is a game',
        isAgeAppropriate: true,
        safetyLevel: 'Low',
        suggestedUrl: 'https://khanacademy.org',
        noUrlReason: null,
      }));
      assert.deepEqual(c, {
        isEducational: false,
        category: 'Games',
        reason: 'It is a game',
        isAgeAppropriate: true,
        safetyLevel: 'Low',
        suggestedUrl: 'https://khanacademy.org',
        noUrlReason: null,
        url: CTX.url,
        title: CTX.title,
        classifiedAt: CTX.now,
        model: 'actual-model',
        educational: false,
        ageAppropriate: true,
        suggestedEducationalResource: 'https://khanacademy.org',
      });
    });

    it('category and safety level are mapped to the allowed list spelling', () => {
      const c = parsedClassification('{"category":"news","safetyLevel":"high"}');
      assert.equal(c.category, 'News');
      assert.equal(c.safetyLevel, 'High');
    });

    it('values outside the allowed lists become Other / Unknown', () => {
      const c = parsedClassification('{"category":"Cooking","safetyLevel":"Extreme"}');
      assert.equal(c.category, 'Other');
      assert.equal(c.safetyLevel, 'Unknown');
    });

    it('missing fields default to Other / Unknown / null / empty', () => {
      const c = parsedClassification('{}');
      assert.equal(c.category, 'Other');
      assert.equal(c.safetyLevel, 'Unknown');
      assert.equal(c.isEducational, null);
      assert.equal(c.isAgeAppropriate, null);
      assert.equal(c.suggestedUrl, null);
      assert.equal(c.noUrlReason, null);
      assert.equal(c.reason, '');
    });

    it('accepts the legacy field names', () => {
      const c = parsedClassification('{"educational":true,"ageAppropriate":false,"suggestedEducationalResource":"https://a.test"}');
      assert.equal(c.isEducational, true);
      assert.equal(c.isAgeAppropriate, false);
      assert.equal(c.suggestedUrl, 'https://a.test');
    });

    it('category Educational clears the suggested URL and supplies a reason', () => {
      const c = parsedClassification('{"category":"educational","suggestedUrl":"https://other.test"}');
      assert.equal(c.suggestedUrl, null);
      assert.equal(c.suggestedEducationalResource, null);
      assert.equal(c.noUrlReason, 'Already educational; no alternate resource suggested.');
    });

    it('category Educational keeps a reason the model supplied', () => {
      const c = parsedClassification('{"category":"Educational","noUrlReason":"Already on target"}');
      assert.equal(c.noUrlReason, 'Already on target');
    });
  });

  describe('JSON located inside other text', () => {
    const body = '{"isEducational":true,"category":"Educational","reason":"lesson"}';

    it('fenced JSON block', () => {
      assert.equal(parsedClassification('```json\n' + body + '\n```').isEducational, true);
    });

    it('prose before and after the object', () => {
      assert.equal(parsedClassification('Sure! Here you go: ' + body + ' Hope this helps.').reason, 'lesson');
    });

    it('nested objects stay balanced', () => {
      const c = parsedClassification('{"category":"News","extra":{"a":{"b":1}},"reason":"nested"}');
      assert.equal(c.reason, 'nested');
    });

    it('only the first top-level object is used', () => {
      const c = parsedClassification('{"reason":"first"} {"reason":"second"}');
      assert.equal(c.reason, 'first');
    });
  });

  describe('replies without a usable object', () => {
    it('no braces at all -> no-json', () => {
      assert.deepEqual(parseModelReply('This looks educational to me.', CTX), { kind: 'no-json' });
    });

    it('unbalanced braces -> no-json', () => {
      assert.deepEqual(parseModelReply('{"category":"News"', CTX), { kind: 'no-json' });
    });

    it('empty reply -> no-json', () => {
      assert.deepEqual(parseModelReply('', CTX), { kind: 'no-json' });
    });

    it('a balanced span that is not valid JSON -> invalid-json with the span', () => {
      const reply = parseModelReply('Result: {isEducational: true}', CTX);
      assert.equal(reply.kind, 'invalid-json');
      if (reply.kind === 'invalid-json') {
        assert.equal(reply.jsonString, '{isEducational: true}');
        assert.ok(reply.error.length > 0);
      }
    });
  });

  describe('current behaviour, see M1', () => {
    it('a closing brace inside a JSON string ends the object early -> invalid-json', () => {
      const reply = parseModelReply('{"reason":"close } here","isEducational":true}', CTX);
      assert.equal(reply.kind, 'invalid-json');
      if (reply.kind === 'invalid-json') {
        assert.equal(reply.jsonString, '{"reason":"close }');
      }
    });

    it('an opening brace inside a JSON string keeps the object open -> no-json', () => {
      assert.deepEqual(parseModelReply('{"reason":"open { here","category":"News"}', CTX), { kind: 'no-json' });
    });

    it('a non-string category makes the whole reply invalid-json', () => {
      assert.equal(parseModelReply('{"category":5,"isEducational":true}', CTX).kind, 'invalid-json');
    });
  });
});

describe('fallbackClassificationFromText', () => {
  const FALLBACK_CTX = { url: CTX.url, title: CTX.title, model: 'requested-model', now: CTX.now };

  it('builds an unknown-category result from the raw text', () => {
    const c = fallbackClassificationFromText('Cannot tell what this is.', FALLBACK_CTX);
    assert.deepEqual(c, {
      isEducational: false,
      category: 'unknown',
      reason: 'Cannot tell what this is.',
      url: CTX.url,
      title: CTX.title,
      classifiedAt: CTX.now,
      model: 'requested-model',
      educational: false,
    });
  });

  it('keeps only the first 200 characters of the text as the reason', () => {
    const c = fallbackClassificationFromText('x'.repeat(500), FALLBACK_CTX);
    assert.equal(c.reason.length, 200);
  });

  describe('current behaviour, see M1: keyword guess ignores negation', () => {
    it('"educational" anywhere means educational, case-insensitively', () => {
      assert.equal(fallbackClassificationFromText('This is EDUCATIONAL content', FALLBACK_CTX).isEducational, true);
    });

    it('"This is not educational content" is classified as educational', () => {
      const c = fallbackClassificationFromText('This is not educational content', FALLBACK_CTX);
      assert.equal(c.isEducational, true);
      assert.equal(c.educational, true);
    });

    it('"Not suitable for children" is classified as educational', () => {
      assert.equal(fallbackClassificationFromText('Not suitable for children', FALLBACK_CTX).isEducational, true);
    });

    it('such a result counts as useful, so it would be cached', () => {
      assert.equal(isClassificationUseful(fallbackClassificationFromText('This is not educational content', FALLBACK_CTX)), true);
    });
  });
});

describe('isClassificationUseful', () => {
  const empty: ClassificationResult = { isEducational: null, category: '', reason: '' };

  function useful(overrides: Partial<ClassificationResult>): boolean {
    return isClassificationUseful({ ...empty, ...overrides });
  }

  it('an empty classification is not useful', () => {
    assert.equal(useful({}), false);
  });

  it('placeholder values are not useful', () => {
    assert.equal(useful({ category: 'unknown', reason: 'Not specified', safetyLevel: 'Not specified', suggestedUrl: 'Not specified' }), false);
    assert.equal(useful({ category: ' Unknown ', reason: '   ' }), false);
  });

  it('isEducational true is useful on its own', () => {
    assert.equal(useful({ isEducational: true, category: 'unknown' }), true);
    assert.equal(useful({ isEducational: null, educational: true }), true);
  });

  it('isEducational false alone is not useful', () => {
    assert.equal(useful({ isEducational: false }), false);
  });

  it('each meaningful field is enough', () => {
    assert.equal(useful({ category: 'News' }), true);
    assert.equal(useful({ reason: 'A news site' }), true);
    assert.equal(useful({ safetyLevel: 'Low' }), true);
    assert.equal(useful({ suggestedUrl: 'https://khanacademy.org' }), true);
    assert.equal(useful({ suggestedEducationalResource: 'https://khanacademy.org' }), true);
    assert.equal(useful({ isAgeAppropriate: true }), true);
    assert.equal(useful({ isAgeAppropriate: false }), true);
    assert.equal(useful({ ageAppropriate: false }), true);
  });

  it('isEducational false plus any other meaningful field is useful', () => {
    assert.equal(useful({ isEducational: false, category: 'Games' }), true);
  });

  it('current behaviour, see M1: an error result with nothing else counts as useful', () => {
    assert.equal(useful({ error: true }), true);
  });
});
