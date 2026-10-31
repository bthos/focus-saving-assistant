import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeDecisionTestResult,
  getDecisionModelStatus,
  isVerifiedDecisionModel,
  needsModelTest,
  validateDecisionSettings,
  type DecisionSettingsError,
} from '../../src/core/decision-models.ts';
import type { Settings } from '../../src/types/index.ts';

const JEV = 'typesafe/jev-1.14-20261014';
const PPLX = 'perplexity/pplx-decider-flash-v1.2-20261016';
const D11 = 'liquid/d1.1-20261027';
const JOEY = 'baseten/joey-1-20261029';
const RESPAN = 'respan/span-01-lite:free';
const NONE: ReadonlySet<string> = new Set();

describe('getDecisionModelStatus', () => {
  it('the probed builds have the probed statuses', () => {
    assert.equal(getDecisionModelStatus(JEV), 'recommended');
    assert.equal(getDecisionModelStatus(PPLX), 'verified');
    assert.equal(getDecisionModelStatus(D11), 'verified');
    assert.equal(getDecisionModelStatus(JOEY), 'not-recommended');
  });

  it('every respan/ model is incompatible', () => {
    assert.equal(getDecisionModelStatus(RESPAN), 'incompatible');
    assert.equal(getDecisionModelStatus('respan/anything-else'), 'incompatible');
  });

  it('anything else is unverified, including another date of a verified family', () => {
    assert.equal(getDecisionModelStatus('typesafe/jev-1.14-20261101'), 'unverified');
    assert.equal(getDecisionModelStatus('liquid/d1.1-20270101'), 'unverified');
    assert.equal(getDecisionModelStatus('someone/new-model-1'), 'unverified');
    assert.equal(getDecisionModelStatus(''), 'unverified');
  });
});

describe('isVerifiedDecisionModel', () => {
  it('is true for recommended, verified and not-recommended only', () => {
    for (const slug of [JEV, PPLX, D11, JOEY]) assert.equal(isVerifiedDecisionModel(slug), true, slug);
    for (const slug of [RESPAN, 'someone/new-model-1', 'typesafe/jev-1.14-20261101']) {
      assert.equal(isVerifiedDecisionModel(slug), false, slug);
    }
  });
});

describe('needsModelTest', () => {
  it('false for verified, recommended and not-recommended models', () => {
    for (const slug of [JEV, PPLX, D11, JOEY]) assert.equal(needsModelTest(slug, NONE), false, slug);
  });

  it('true for an unverified slug that has not passed a test', () => {
    assert.equal(needsModelTest('someone/new-model-1', NONE), true);
    assert.equal(needsModelTest('someone/new-model-1', new Set(['someone/other-1'])), true);
  });

  it('false for an unverified slug that passed (exactly that slug)', () => {
    assert.equal(needsModelTest('someone/new-model-1', new Set(['someone/new-model-1'])), false);
    assert.equal(needsModelTest('someone/new-model-1', new Set(['someone/new-model-2'])), true);
  });
});

describe('validateDecisionSettings', () => {
  type Form = Pick<Settings, 'decisionEnabled' | 'decisionApiToken' | 'decisionModel' | 'aiProvider' | 'aiApiToken'>;

  function form(overrides: Partial<Form> = {}): Form {
    return {
      decisionEnabled: true,
      decisionApiToken: 'dec-key',
      decisionModel: JEV,
      aiProvider: 'github',
      aiApiToken: '',
      ...overrides,
    };
  }

  const check = (f: Form, tested: ReadonlySet<string> = NONE): DecisionSettingsError | null => validateDecisionSettings(f, tested);

  it('a complete, verified configuration passes', () => {
    assert.equal(check(form()), null);
  });

  it('nothing is reported when the decision stage is off, however broken the fields are', () => {
    assert.equal(check(form({ decisionEnabled: false, decisionApiToken: '', decisionModel: '' })), null);
    assert.equal(check(form({ decisionEnabled: false, decisionModel: RESPAN })), null);
    assert.equal(check(form({ decisionEnabled: false, decisionModel: 'someone/new-model-1' })), null);
  });

  it('1. no resolvable token -> missing-token on the key field', () => {
    const err = check(form({ decisionApiToken: '  ', aiProvider: 'github', aiApiToken: 'gh-token' }));
    assert.equal(err?.code, 'missing-token');
    assert.equal(err?.field, 'decisionApiToken');
    assert.ok((err?.message ?? '').length > 0);
  });

  it('the OpenRouter generative key counts as a token', () => {
    assert.equal(check(form({ decisionApiToken: '', aiProvider: 'openrouter', aiApiToken: 'or-key' })), null);
  });

  it('2. an alias or empty model -> not-pinned on the model field', () => {
    for (const decisionModel of ['', '   ', '~liquid/d1.1', 'liquid/d1.1-latest', 'nomodel']) {
      const err = check(form({ decisionModel }));
      assert.equal(err?.code, 'not-pinned', JSON.stringify(decisionModel));
      assert.equal(err?.field, 'decisionModel');
    }
  });

  it('3. an incompatible model is rejected with the fixed copy', () => {
    const err = check(form({ decisionModel: RESPAN }));
    assert.equal(err?.code, 'incompatible');
    assert.equal(err?.field, 'decisionModel');
    assert.equal(err?.message, 'This model does not accept the request and cannot be used.');
  });

  it('4. an unverified model that was not tested is rejected with the fixed copy', () => {
    const err = check(form({ decisionModel: 'someone/new-model-1' }));
    assert.equal(err?.code, 'needs-test');
    assert.equal(err?.field, 'decisionModel');
    assert.equal(
      err?.message,
      'This model has not been verified with this extension. Press "Test model" and wait for a pass, or choose a model marked ✓.',
    );
  });

  it('an unverified model passes once its test passed', () => {
    assert.equal(check(form({ decisionModel: 'someone/new-model-1' }), new Set(['someone/new-model-1'])), null);
  });

  it('recommended, verified and not-recommended models need no test', () => {
    for (const decisionModel of [JEV, PPLX, D11, JOEY]) {
      assert.equal(check(form({ decisionModel })), null, decisionModel);
    }
  });

  it('reports only the first failing rule, in the order token, pinned id, incompatible, needs-test', () => {
    // token and model both wrong: the token comes first
    assert.equal(check(form({ decisionApiToken: '', decisionModel: '' }))?.code, 'missing-token');
    // pinned id before verification: an alias is "not pinned", not "needs a test"
    assert.equal(check(form({ decisionModel: '~someone/new' }))?.code, 'not-pinned');
    // incompatible before needs-test even though the slug is also untested
    assert.equal(check(form({ decisionModel: RESPAN }), NONE)?.code, 'incompatible');
  });

  it('a passed test does not rescue an incompatible model', () => {
    assert.equal(check(form({ decisionModel: RESPAN }), new Set([RESPAN]))?.code, 'incompatible');
  });
});

describe('describeDecisionTestResult (AC41)', () => {
  it('pass: response model and latency', () => {
    assert.equal(
      describeDecisionTestResult({ kind: 'pass', model: 'liquid/d1.1-20261027', latencyMs: 312 }),
      'Test passed: liquid/d1.1-20261027 answered in 312 ms.',
    );
  });

  it('400: the model rejected our state', () => {
    const body = JSON.stringify({ error: { message: 'Respan state must be a string or an object' } });
    assert.equal(
      describeDecisionTestResult({ kind: 'http', status: 400, bodyText: body }),
      'Test failed: Decision model did not accept the request: Respan state must be a string or an object',
    );
  });

  it('401, 402, 429 and 5xx reuse the HTTP error text', () => {
    assert.equal(describeDecisionTestResult({ kind: 'http', status: 401, bodyText: '' }), 'Test failed: OpenRouter rejected the API key');
    assert.equal(describeDecisionTestResult({ kind: 'http', status: 402, bodyText: '' }), 'Test failed: OpenRouter account has insufficient credits');
    assert.equal(describeDecisionTestResult({ kind: 'http', status: 429, bodyText: '' }), 'Test failed: OpenRouter rate limit reached');
    assert.equal(describeDecisionTestResult({ kind: 'http', status: 500, bodyText: '' }), 'Test failed: OpenRouter Decisions service error (500)');
    assert.equal(describeDecisionTestResult({ kind: 'http', status: 503, bodyText: '' }), 'Test failed: OpenRouter Decisions service error (503)');
  });

  it('a validator failure -> unexpected answer with the code', () => {
    assert.equal(
      describeDecisionTestResult({ kind: 'invalid', code: 'missing-answer:safety_level' }),
      'Test failed: unexpected answer (missing-answer:safety_level)',
    );
  });

  it('a network failure is reported with its message', () => {
    assert.equal(describeDecisionTestResult({ kind: 'network', message: 'Failed to fetch' }), 'Test failed: Failed to fetch');
  });
});
