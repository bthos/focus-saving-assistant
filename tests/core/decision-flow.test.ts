/**
 * Stage 1 end to end on pure code: request -> real/synthetic answer -> parse -> map -> block decision.
 * No I/O: the answer is a recorded or hand-written JSON value.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CATEGORY_ITEMS,
  DEFAULT_SAFETY_LEVEL_ITEMS,
  type ClassificationItem,
} from '../../src/core/classification-defaults.ts';
import { matchesContentRestrictions } from '../../src/core/content-restrictions.ts';
import { buildDecisionRequest, type DecisionRequest } from '../../src/core/decision-request.ts';
import {
  mapDecisionToClassification,
  parseDecisionResponse,
  type DecisionMapContext,
} from '../../src/core/decision-response.ts';
import type { ClassificationResult } from '../../src/types/index.ts';
import { decisionFixture, probeRequest } from './helpers/decision-fixture.ts';

const restrictedNames = (items: readonly ClassificationItem[]): string[] =>
  items.filter((i) => i.restricted).map((i) => i.name);

const DEFAULT_CATEGORIES = restrictedNames(DEFAULT_CATEGORY_ITEMS);
const DEFAULT_LEVELS = restrictedNames(DEFAULT_SAFETY_LEVEL_ITEMS);

function ctx(categories: readonly ClassificationItem[], levels: readonly ClassificationItem[], url = 'https://example.com/x'): DecisionMapContext {
  return {
    url,
    title: 'T',
    now: 1_800_000_000_000,
    requestedModel: 'liquid/d1.1-20261027',
    latencyMs: 240,
    restrictedCategories: restrictedNames(categories),
    restrictedSafetyLevels: restrictedNames(levels),
    explanationActive: true,
  };
}

/** Parses a response and maps it; fails the test when the response is rejected. */
function decide(
  req: DecisionRequest,
  response: unknown,
  categories: readonly ClassificationItem[],
  levels: readonly ClassificationItem[],
): ClassificationResult {
  const parsed = parseDecisionResponse(response, req);
  if (!parsed.ok) assert.fail(`parse failed: ${parsed.code}`);
  return mapDecisionToClassification(parsed, ctx(categories, levels));
}

describe('recorded responses through the whole Stage 1 path (default lists)', () => {
  const educational = decisionFixture.cases.find((c) => c.kind === 'educational');
  const adversarial = decisionFixture.cases.filter((c) => c.kind === 'adversarial');

  it('the educational Khan Academy row is classified Educational / Low and is not blocked', () => {
    assert.ok(educational);
    const c = decide(probeRequest(educational), educational.response, DEFAULT_CATEGORY_ITEMS, DEFAULT_SAFETY_LEVEL_ITEMS);
    assert.equal(c.category, 'Educational');
    assert.equal(c.safetyLevel, 'Low');
    assert.equal(c.isEducational, true);
    assert.equal(c.isAgeAppropriate, true);
    assert.equal(c.suggestedUrl, null);
    assert.ok((c.noUrlReason ?? '').length > 0);
    assert.equal(matchesContentRestrictions(c, DEFAULT_CATEGORIES, DEFAULT_LEVELS), false);
  });

  it('there is one adversarial row per probed model', () => {
    assert.equal(adversarial.length, 4);
    assert.equal(new Set(adversarial.map((c) => c.model)).size, 4);
  });

  for (const row of decisionFixture.cases.filter((c) => c.kind === 'adversarial')) {
    describe(`${row.model}: casino URL with a flattering "Educational resource" title`, () => {
      const classify = (): ClassificationResult =>
        decide(probeRequest(row), row.response, DEFAULT_CATEGORY_ITEMS, DEFAULT_SAFETY_LEVEL_ITEMS);

      it('the title fools the category (Educational), so a category-only restriction would let it through', () => {
        const c = classify();
        assert.equal(c.category, 'Educational');
        assert.equal(matchesContentRestrictions(c, DEFAULT_CATEGORIES, []), false);
      });

      it('safety_level is the guard: the chosen High level blocks the page with the default lists', () => {
        const c = classify();
        assert.equal(c.safetyLevel, 'High');
        assert.equal(matchesContentRestrictions(c, DEFAULT_CATEGORIES, DEFAULT_LEVELS), true);
      });

      it('the safety verdict is kept even though its probability is recorded and may be weak (no demotion)', () => {
        const c = classify();
        assert.equal(typeof c.decision?.safetyProbability, 'number');
        assert.equal(c.safetyLevel, 'High');
      });
    });
  }
});

describe('AC48 — the Other category removed or kept', () => {
  const NO_OTHER: ClassificationItem[] = [
    { name: 'Educational', restricted: false },
    { name: 'Games', restricted: true },
    { name: 'News', restricted: false },
  ];

  function requestFor(categories: readonly ClassificationItem[]): DecisionRequest {
    return buildDecisionRequest({
      url: 'https://example.com/x',
      title: 'T',
      audience: 'children',
      categories,
      safetyLevels: DEFAULT_SAFETY_LEVEL_ITEMS,
      model: 'liquid/d1.1-20261027',
    });
  }

  function answers(category: string, safety: string, fits?: number): Record<string, unknown> {
    const a: Record<string, unknown> = {
      is_educational: { type: 'noul', noul: 0.1 },
      is_age_appropriate: { type: 'noul', noul: 0.9 },
      category: { type: 'choice', choice: category },
      safety_level: { type: 'choice', choice: safety },
    };
    if (fits !== undefined) a.category_fits = { type: 'noul', noul: fits };
    return { model: 'liquid/d1.1-20261027', answers: a };
  }

  it('without an Other item the request asks category_fits, and "none fits" (0.2) maps to category Other', () => {
    const req = requestFor(NO_OTHER);
    assert.ok('category_fits' in req.questions);
    const c = decide(req, answers('Games', 'Low', 0.2), NO_OTHER, DEFAULT_SAFETY_LEVEL_ITEMS);
    assert.equal(c.category, 'Other');
  });

  it('that mapped Other is not in the list, so the category check does not block even though Games was chosen', () => {
    const req = requestFor(NO_OTHER);
    const c = decide(req, answers('Games', 'Low', 0.2), NO_OTHER, DEFAULT_SAFETY_LEVEL_ITEMS);
    assert.equal(matchesContentRestrictions(c, restrictedNames(NO_OTHER), restrictedNames(DEFAULT_SAFETY_LEVEL_ITEMS)), false);
  });

  it('a restricted safety level still blocks when the category fell back to Other', () => {
    const req = requestFor(NO_OTHER);
    const c = decide(req, answers('Games', 'High', 0.2), NO_OTHER, DEFAULT_SAFETY_LEVEL_ITEMS);
    assert.equal(c.category, 'Other');
    assert.equal(matchesContentRestrictions(c, restrictedNames(NO_OTHER), restrictedNames(DEFAULT_SAFETY_LEVEL_ITEMS)), true);
  });

  it('when the page does fit (0.9) the chosen restricted category blocks as usual', () => {
    const req = requestFor(NO_OTHER);
    const c = decide(req, answers('Games', 'Low', 0.9), NO_OTHER, DEFAULT_SAFETY_LEVEL_ITEMS);
    assert.equal(c.category, 'Games');
    assert.equal(matchesContentRestrictions(c, restrictedNames(NO_OTHER), restrictedNames(DEFAULT_SAFETY_LEVEL_ITEMS)), true);
  });

  it('with an Other item set to Block, category_fits is not asked and the model\'s own Other answer blocks', () => {
    const withBlockedOther: ClassificationItem[] = [...NO_OTHER, { name: 'Other', restricted: true }];
    const req = requestFor(withBlockedOther);
    assert.equal('category_fits' in req.questions, false);
    const c = decide(req, answers('Other', 'Low'), withBlockedOther, DEFAULT_SAFETY_LEVEL_ITEMS);
    assert.equal(c.category, 'Other');
    assert.equal(
      matchesContentRestrictions(c, restrictedNames(withBlockedOther), restrictedNames(DEFAULT_SAFETY_LEVEL_ITEMS)),
      true,
    );
  });

  it('an empty category list sends the built-in defaults and never blocks by category', () => {
    const req = requestFor([]);
    assert.deepEqual(Object.keys(req.questions.category.criteria), DEFAULT_CATEGORY_ITEMS.map((i) => i.name));
    // every default category, including the usually restricted ones, is a valid answer ...
    const c = decide(req, answers('Games', 'Low'), [], DEFAULT_SAFETY_LEVEL_ITEMS);
    assert.equal(c.category, 'Games');
    // ... but the parent's list is empty, so nothing is restricted by category
    assert.equal(matchesContentRestrictions(c, restrictedNames([]), []), false);
  });
});
