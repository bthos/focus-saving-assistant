import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { withNoticeFinalized, withoutTelegramNotice, withTelegramNotice } from '../../src/core/explanation.ts';
import type { ClassificationResult, TelegramNoticeRef } from '../../src/types/index.ts';

const ref: TelegramNoticeRef = { chatId: '1', messageId: 7, keyboardUrl: 'https://a.example/', finalized: false, text: 'T', fallbackText: 'F' };
const base: ClassificationResult = { isEducational: false, category: 'Games', reason: 'r', generative: { status: 'pending', attemptedAt: 1 } };

describe('withoutTelegramNotice', () => {
  it('removes only the message reference and keeps the generative state', () => {
    const withRef = withTelegramNotice(base, ref);
    const stripped = withoutTelegramNotice(withRef);
    assert.deepEqual(stripped.generative, { status: 'pending', attemptedAt: 1 });
    assert.equal(stripped.category, 'Games');
    assert.ok(withRef.generative?.telegram, 'input is not mutated');
  });

  it('also strips a finalized reference', () => {
    const stripped = withoutTelegramNotice(withNoticeFinalized(withTelegramNotice(base, ref)));
    assert.equal(stripped.generative?.telegram, undefined);
  });

  it('returns the same object when there is no reference', () => {
    assert.equal(withoutTelegramNotice(base), base);
    const legacy: ClassificationResult = { isEducational: null, category: 'Other', reason: '' };
    assert.equal(withoutTelegramNotice(legacy), legacy);
  });
});
