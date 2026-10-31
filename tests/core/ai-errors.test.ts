import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { prefixStageError, shouldClearAiError } from '../../src/core/ai-errors.ts';

describe('prefixStageError', () => {
  it('adds the stage prefix', () => {
    assert.equal(prefixStageError('decision', 'OpenRouter rejected the API key'), 'Decision model: OpenRouter rejected the API key');
    assert.equal(prefixStageError('explanation', 'timeout'), 'Explanation model: timeout');
  });

  it('is idempotent', () => {
    for (const stage of ['decision', 'explanation'] as const) {
      const once = prefixStageError(stage, 'boom');
      assert.equal(prefixStageError(stage, once), once, stage);
    }
  });

  it('does not double the 400 text that already names the decision model', () => {
    const text = 'Decision model did not accept the request: Respan state must be a string';
    assert.equal(prefixStageError('decision', text), text);
  });

  it('passes the message through unchanged when no stage is given (single-call mode)', () => {
    assert.equal(prefixStageError(undefined, 'GitHub AI API error: 401'), 'GitHub AI API error: 401');
    assert.equal(prefixStageError(undefined, 'Decision model: already'), 'Decision model: already');
  });
});

describe('shouldClearAiError', () => {
  it('true when nothing is stored', () => {
    for (const stage of ['decision', 'explanation'] as const) {
      assert.equal(shouldClearAiError('', stage), true, stage);
      assert.equal(shouldClearAiError(undefined, stage), true, stage);
      assert.equal(shouldClearAiError(null, stage), true, stage);
    }
  });

  it('true when the stored error is the caller\'s own', () => {
    assert.equal(shouldClearAiError('Decision model: timeout', 'decision'), true);
    assert.equal(shouldClearAiError('Explanation model: timeout', 'explanation'), true);
  });

  it('the decision 400 text counts as the decision stage\'s own error', () => {
    assert.equal(shouldClearAiError('Decision model did not accept the request: nope', 'decision'), true);
  });

  it('false when the stored error belongs to the other stage: a success must not erase the other failure', () => {
    assert.equal(shouldClearAiError('Explanation model: timeout', 'decision'), false);
    assert.equal(shouldClearAiError('Decision model: timeout', 'explanation'), false);
  });

  it('true in single-call mode (no stage), whatever is stored', () => {
    assert.equal(shouldClearAiError('GitHub AI API error: 401', undefined), true);
    assert.equal(shouldClearAiError('', undefined), true);
    assert.equal(shouldClearAiError(undefined, undefined), true);
    assert.equal(shouldClearAiError('Explanation model: x', undefined), true);
  });
});
