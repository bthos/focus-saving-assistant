import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  isAiClassificationActive,
  isPinnedDecisionModel,
  isStage1Configured,
  isStage2Active,
  resolveAiMode,
  resolveDecisionToken,
} from '../../src/core/ai-mode.ts';
import type { Settings } from '../../src/types/index.ts';

type ModeSettings = Pick<
  Settings,
  | 'enableAIClassification'
  | 'aiProvider'
  | 'aiApiToken'
  | 'decisionEnabled'
  | 'decisionApiToken'
  | 'decisionModel'
  | 'enableAIExplanation'
>;

const PINNED = 'liquid/d1.1-20261027';

/** Fully configured two-stage settings; each test overrides what it is about. */
function settings(overrides: Partial<ModeSettings> = {}): ModeSettings {
  return {
    enableAIClassification: true,
    aiProvider: 'openrouter',
    aiApiToken: 'or-key',
    decisionEnabled: true,
    decisionApiToken: 'dec-key',
    decisionModel: PINNED,
    enableAIExplanation: true,
    ...overrides,
  };
}

describe('resolveAiMode', () => {
  it('master switch off -> off, whatever else is configured', () => {
    assert.equal(resolveAiMode(settings({ enableAIClassification: false })), 'off');
  });

  it('Stage 1 configured -> two-stage', () => {
    assert.equal(resolveAiMode(settings()), 'two-stage');
  });

  it('Stage 1 configured stays two-stage with or without a generative token (decision-only)', () => {
    assert.equal(resolveAiMode(settings({ aiApiToken: '' })), 'two-stage');
    assert.equal(resolveAiMode(settings({ aiApiToken: '   ', aiProvider: 'github' })), 'two-stage');
  });

  it('no Stage 1 but a generative token -> single (today\'s behaviour)', () => {
    assert.equal(resolveAiMode(settings({ decisionEnabled: false })), 'single');
  });

  it('neither Stage 1 nor a generative token -> off', () => {
    assert.equal(resolveAiMode(settings({ decisionEnabled: false, aiApiToken: '' })), 'off');
  });

  it('whitespace-only tokens count as empty', () => {
    assert.equal(resolveAiMode(settings({ decisionEnabled: false, aiApiToken: '  \t ' })), 'off');
    // decision key blank and generative key blank: nothing to resolve
    assert.equal(
      resolveAiMode(settings({ decisionApiToken: '   ', aiApiToken: '   ', aiProvider: 'openrouter' })),
      'off',
    );
  });

  it('decisionEnabled with an empty model is not configured -> falls to single, or off without a token', () => {
    assert.equal(resolveAiMode(settings({ decisionModel: '' })), 'single');
    assert.equal(resolveAiMode(settings({ decisionModel: '   ' })), 'single');
    assert.equal(resolveAiMode(settings({ decisionModel: '', aiApiToken: '' })), 'off');
  });

  it('decisionEnabled with an alias model is not configured', () => {
    assert.equal(resolveAiMode(settings({ decisionModel: '~liquid/d1.1-latest' })), 'single');
    assert.equal(resolveAiMode(settings({ decisionModel: 'liquid/d1.1-latest' })), 'single');
  });

  it('decisionEnabled with no resolvable token is not configured', () => {
    // own token empty, generative provider is GitHub: a GitHub token must never be reused
    assert.equal(
      resolveAiMode(settings({ decisionApiToken: '', aiProvider: 'github', aiApiToken: 'gh-token' })),
      'single',
    );
    assert.equal(
      resolveAiMode(settings({ decisionApiToken: '', aiProvider: 'github', aiApiToken: '' })),
      'off',
    );
  });

  it('decisionEnabled with an empty own token reuses the OpenRouter generative token', () => {
    assert.equal(
      resolveAiMode(settings({ decisionApiToken: '', aiProvider: 'openrouter', aiApiToken: 'or-key' })),
      'two-stage',
    );
  });

  it('decisionEnabled false is never two-stage even if model and token are set', () => {
    assert.equal(resolveAiMode(settings({ decisionEnabled: false })), 'single');
  });
});

describe('isAiClassificationActive', () => {
  it('is true for single and two-stage, false for off', () => {
    assert.equal(isAiClassificationActive(settings()), true);
    assert.equal(isAiClassificationActive(settings({ decisionEnabled: false })), true);
    assert.equal(isAiClassificationActive(settings({ decisionEnabled: false, aiApiToken: '' })), false);
    assert.equal(isAiClassificationActive(settings({ enableAIClassification: false })), false);
  });
});

describe('isStage1Configured / isStage2Active', () => {
  it('Stage 1 needs the toggle, a pinned model and a resolvable token', () => {
    assert.equal(isStage1Configured(settings()), true);
    assert.equal(isStage1Configured(settings({ decisionEnabled: false })), false);
    assert.equal(isStage1Configured(settings({ decisionModel: 'nomodel' })), false);
  });

  it('Stage 2 needs two-stage mode, the explanation toggle and a generative token', () => {
    assert.equal(isStage2Active(settings()), true);
    assert.equal(isStage2Active(settings({ enableAIExplanation: false })), false);
    assert.equal(isStage2Active(settings({ aiApiToken: '  ' })), false);
    assert.equal(isStage2Active(settings({ decisionEnabled: false })), false, 'single mode has no Stage 2');
    assert.equal(isStage2Active(settings({ enableAIClassification: false })), false);
  });
});

describe('resolveDecisionToken', () => {
  it('the own token wins, even when the generative provider is OpenRouter', () => {
    assert.equal(
      resolveDecisionToken({ decisionApiToken: 'own', aiProvider: 'openrouter', aiApiToken: 'other' }),
      'own',
    );
  });

  it('is trimmed', () => {
    assert.equal(
      resolveDecisionToken({ decisionApiToken: '  own  ', aiProvider: 'github', aiApiToken: '' }),
      'own',
    );
  });

  it('an empty own token reuses aiApiToken only for provider openrouter', () => {
    assert.equal(
      resolveDecisionToken({ decisionApiToken: '', aiProvider: 'openrouter', aiApiToken: 'or-key' }),
      'or-key',
    );
    assert.equal(
      resolveDecisionToken({ decisionApiToken: '   ', aiProvider: 'openrouter', aiApiToken: ' or-key ' }),
      'or-key',
    );
  });

  it('with provider github an empty own token resolves to the empty string (GitHub token is never reused)', () => {
    assert.equal(
      resolveDecisionToken({ decisionApiToken: '', aiProvider: 'github', aiApiToken: 'gh-secret' }),
      '',
    );
  });
});

describe('isPinnedDecisionModel', () => {
  it('accepts a dated vendor/model slug', () => {
    assert.equal(isPinnedDecisionModel('liquid/d1.1-20261027'), true);
    assert.equal(isPinnedDecisionModel('typesafe/jev-1.14-20261014'), true);
  });

  it('rejects empty and whitespace-only ids', () => {
    assert.equal(isPinnedDecisionModel(''), false);
    assert.equal(isPinnedDecisionModel('   '), false);
  });

  it('rejects aliases: leading ~ and trailing -latest', () => {
    assert.equal(isPinnedDecisionModel('~openai/foo-latest'), false);
    assert.equal(isPinnedDecisionModel('~openai/foo'), false);
    assert.equal(isPinnedDecisionModel('liquid/d1.1-latest'), false);
  });

  it('rejects an id without a vendor slash', () => {
    assert.equal(isPinnedDecisionModel('nomodel'), false);
  });
});
