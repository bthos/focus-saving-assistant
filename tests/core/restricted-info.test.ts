import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyExplanationToRestrictedInfo,
  buildReasonDetails,
  type RestrictedInfo,
} from '../../src/core/restricted-info.ts';
import type { ClassificationResult } from '../../src/types/index.ts';

describe('buildReasonDetails (the lines the two duplicated blocks in navigation-handler build today)', () => {
  const c = { category: 'Games', safetyLevel: 'Medium', reason: 'Gaming portal.' };

  it('content-restricted: Category, Safety Level and Reason lines, in that order', () => {
    assert.deepEqual(buildReasonDetails('content-restricted', null, c), [
      'Category: Games',
      'Safety Level: Medium',
      'Reason: Gaming portal.',
    ]);
  });

  it('content-restricted skips the lines whose value is empty', () => {
    assert.deepEqual(buildReasonDetails('content-restricted', null, { category: 'Games', safetyLevel: null, reason: '' }), [
      'Category: Games',
    ]);
    assert.deepEqual(buildReasonDetails('content-restricted', null, { category: '', safetyLevel: 'High', reason: 'r' }), [
      'Safety Level: High',
      'Reason: r',
    ]);
  });

  it('content-restricted ignores a matched pattern', () => {
    assert.deepEqual(buildReasonDetails('content-restricted', 'a.org', { category: 'Games', safetyLevel: '', reason: '' }), [
      'Category: Games',
    ]);
  });

  it('restricted with a matched pattern: the rule line', () => {
    assert.deepEqual(buildReasonDetails('restricted', 'youtube.com/*', null), ['Matches rule: youtube.com/*']);
    assert.deepEqual(buildReasonDetails('restricted', 'youtube.com/*', c), ['Matches rule: youtube.com/*']);
  });

  it('null when there is nothing to list', () => {
    assert.equal(buildReasonDetails('restricted', null, null), null);
    assert.equal(buildReasonDetails('restricted', '', c), null);
    assert.equal(buildReasonDetails('content-restricted', null, null), null);
    assert.equal(buildReasonDetails('content-restricted', null, undefined), null);
    assert.equal(buildReasonDetails('content-restricted', null, { category: '', safetyLevel: '', reason: '' }), null);
  });

  it('null for every other reason code, whatever is passed', () => {
    for (const code of ['outside-hours', 'allowed', 'permitted', '']) {
      assert.equal(buildReasonDetails(code, 'a.org', c), null, code);
    }
  });
});

describe('applyExplanationToRestrictedInfo', () => {
  const URL = 'https://games.example.com/play';

  function info(overrides: Partial<RestrictedInfo> = {}): RestrictedInfo {
    return {
      url: URL,
      timestamp: 1000,
      reason: 'content-restricted',
      matchedPattern: null,
      tabId: 5,
      suggestedUrl: null,
      category: 'Games',
      safetyLevel: 'Medium',
      classificationReason: 'Category "Games" is blocked in the settings.',
      reasonDetails: ['Category: Games', 'Safety Level: Medium', 'Reason: Category "Games" is blocked in the settings.'],
      reasonPending: true,
      explanationStatus: 'pending',
      ...overrides,
    };
  }

  function finalClassification(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
    return {
      isEducational: false,
      category: 'Games',
      safetyLevel: 'Medium',
      reason: 'This is a gaming portal.',
      suggestedUrl: 'https://www.khanacademy.org/math',
      noUrlReason: null,
      ...overrides,
    };
  }

  it('done: takes reason, suggestion and noUrlReason from the classification, rebuilds the details, settles the flags', () => {
    const out = applyExplanationToRestrictedInfo(info(), { url: URL, status: 'done', classification: finalClassification() });
    assert.equal(out.classificationReason, 'This is a gaming portal.');
    assert.equal(out.suggestedUrl, 'https://www.khanacademy.org/math');
    assert.equal(out.noUrlReason, null);
    assert.deepEqual(out.reasonDetails, ['Category: Games', 'Safety Level: Medium', 'Reason: This is a gaming portal.']);
    assert.equal(out.reasonPending, false);
    assert.equal(out.explanationStatus, 'done');
  });

  it('done without a link carries the noUrlReason', () => {
    const out = applyExplanationToRestrictedInfo(info(), {
      url: URL,
      status: 'done',
      classification: finalClassification({ suggestedUrl: null, noUrlReason: 'No valid educational link could be suggested.' }),
    });
    assert.equal(out.suggestedUrl, null);
    assert.equal(out.noUrlReason, 'No valid educational link could be suggested.');
  });

  it('done reads the legacy suggestedEducationalResource mirror too', () => {
    const out = applyExplanationToRestrictedInfo(info(), {
      url: URL,
      status: 'done',
      classification: finalClassification({ suggestedUrl: undefined, suggestedEducationalResource: 'https://a.org/x' }),
    });
    assert.equal(out.suggestedUrl, 'https://a.org/x');
  });

  it('done keeps what the explanation does not own (url, tab, timestamp, reason code, category lines)', () => {
    const before = info();
    const out = applyExplanationToRestrictedInfo(before, { url: URL, status: 'done', classification: finalClassification() });
    assert.equal(out.url, URL);
    assert.equal(out.tabId, 5);
    assert.equal(out.timestamp, 1000);
    assert.equal(out.reason, 'content-restricted');
    assert.equal(out.category, 'Games');
    assert.equal(out.safetyLevel, 'Medium');
  });

  it('failed: marks failed, stops pending, leaves the synthesized reason and details untouched', () => {
    const before = info();
    const out = applyExplanationToRestrictedInfo(before, { url: URL, status: 'failed' });
    assert.equal(out.explanationStatus, 'failed');
    assert.equal(out.reasonPending, false);
    assert.equal(out.classificationReason, before.classificationReason);
    assert.deepEqual(out.reasonDetails, before.reasonDetails);
    assert.equal(out.suggestedUrl, null);
  });

  it('an outcome for a different URL returns the very same object', () => {
    const before = info();
    assert.equal(applyExplanationToRestrictedInfo(before, { url: 'https://other.example/', status: 'failed' }), before);
    assert.equal(
      applyExplanationToRestrictedInfo(before, { url: 'https://other.example/', status: 'done', classification: finalClassification() }),
      before,
    );
  });

  it('an info without explanationStatus (plain block, or written by an older build) is valid input', () => {
    const plain = info();
    delete plain.explanationStatus;
    delete plain.reasonPending;
    const out = applyExplanationToRestrictedInfo(plain, { url: URL, status: 'done', classification: finalClassification() });
    assert.equal(out.explanationStatus, 'done');
    assert.equal(out.reasonPending, false);
  });

  it('does not mutate its input', () => {
    const before = info();
    const snapshot = JSON.parse(JSON.stringify(before));
    applyExplanationToRestrictedInfo(before, { url: URL, status: 'done', classification: finalClassification() });
    applyExplanationToRestrictedInfo(before, { url: URL, status: 'failed' });
    assert.deepEqual(before, snapshot);
  });
});
