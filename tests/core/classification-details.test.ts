import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPLANATION_PENDING_SUGGESTION,
  describeDecisionModel,
  describeExplanationModel,
  describeMissingSuggestion,
  formatProbabilityAnswer,
  isExplanationPending,
  isSynthesizedReason,
} from '../../src/core/classification-details.ts';
import type { ClassificationResult } from '../../src/types/index.ts';

const NOW = 1_000_000;
const base: ClassificationResult = { isEducational: false, category: 'Games', reason: 'r' };

describe('formatProbabilityAnswer', () => {
  it('shows the answer with the probability of that answer', () => {
    assert.equal(formatProbabilityAnswer(0.93), 'Yes (93%)');
    assert.equal(formatProbabilityAnswer(0.7), 'Yes (70%)');
    assert.equal(formatProbabilityAnswer(0.12), 'No (88%)');
    assert.equal(formatProbabilityAnswer(0.3), 'No (70%)');
    assert.equal(formatProbabilityAnswer(0.55), 'Unknown (55% yes)');
  });

  it('is null when there is no usable probability', () => {
    assert.equal(formatProbabilityAnswer(undefined), null);
    assert.equal(formatProbabilityAnswer(null), null);
    assert.equal(formatProbabilityAnswer(Number.NaN), null);
  });
});

describe('describeDecisionModel', () => {
  it('is null for legacy single-call entries', () => {
    assert.equal(describeDecisionModel({ ...base, model: 'gpt-4' }), null);
  });

  it('shows the exact build and the requested slug only when it differs', () => {
    const decision = { requestedModel: 'liquid/d1.1-20261027', model: 'liquid/d1.1-20261027', probabilities: { isEducational: 0.1, isAgeAppropriate: 0.9 }, categoryProbability: null, safetyProbability: null, latencyMs: 1 };
    assert.equal(describeDecisionModel({ ...base, source: 'decision', decision }), 'liquid/d1.1-20261027');
    assert.equal(
      describeDecisionModel({ ...base, source: 'decision', decision: { ...decision, model: 'liquid/d1.1-20261030' } }),
      'liquid/d1.1-20261030 (requested: liquid/d1.1-20261027)'
    );
    assert.equal(describeDecisionModel({ ...base, source: 'decision', model: 'x/y' }), 'x/y');
  });
});

describe('describeExplanationModel / isExplanationPending', () => {
  it('has no row without a generative state', () => {
    assert.equal(describeExplanationModel(base, NOW), null);
    assert.equal(isExplanationPending(base, NOW), false);
  });

  it('done shows the model, with a fallback for a missing one', () => {
    assert.deepEqual(describeExplanationModel({ ...base, generative: { status: 'done', attemptedAt: NOW, model: 'gpt-4o' } }, NOW), { text: 'gpt-4o', failed: false });
    assert.deepEqual(describeExplanationModel({ ...base, generative: { status: 'done', attemptedAt: NOW } }, NOW), { text: 'Unknown model', failed: false });
  });

  it('pending is fresh below 30 s and failed from 30 s on', () => {
    const at = (age: number): ClassificationResult => ({ ...base, generative: { status: 'pending', attemptedAt: NOW - age } });
    assert.deepEqual(describeExplanationModel(at(29_999), NOW), { text: 'Pending…', failed: false });
    assert.equal(isExplanationPending(at(29_999), NOW), true);
    assert.deepEqual(describeExplanationModel(at(30_000), NOW), { text: 'Failed', failed: true });
    assert.equal(isExplanationPending(at(30_000), NOW), false);
  });

  it('failed shows the error cut at 120 characters, and omits an empty one', () => {
    const failed = (error?: string): ClassificationResult => ({ ...base, generative: { status: 'failed', attemptedAt: NOW, error } });
    assert.equal(describeExplanationModel(failed('HTTP 402'), NOW)?.text, 'Failed (HTTP 402)');
    assert.equal(describeExplanationModel(failed('x'.repeat(500)), NOW)?.text, `Failed (${'x'.repeat(120)})`);
    assert.equal(describeExplanationModel(failed('  '), NOW)?.text, 'Failed');
    assert.equal(describeExplanationModel(failed(undefined), NOW)?.text, 'Failed');
  });
});

describe('describeMissingSuggestion', () => {
  it('keeps the old text, and says pending while Stage 2 runs', () => {
    assert.equal(describeMissingSuggestion({ ...base, noUrlReason: 'No luck' }, NOW), 'Not specified (No luck)');
    assert.equal(describeMissingSuggestion(base, NOW), 'Not specified');
    assert.equal(
      describeMissingSuggestion({ ...base, noUrlReason: 'old', generative: { status: 'pending', attemptedAt: NOW - 1000 } }, NOW),
      EXPLANATION_PENDING_SUGGESTION
    );
  });
});

describe('isSynthesizedReason', () => {
  it('is true only for the extension-written reason', () => {
    assert.equal(isSynthesizedReason({ ...base, reasonSource: 'synthesized' }), true);
    assert.equal(isSynthesizedReason({ ...base, reasonSource: 'model' }), false);
    assert.equal(isSynthesizedReason(base), false);
  });
});
