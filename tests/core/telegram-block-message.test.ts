import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  EXPLANATION_STALE_PENDING_MS,
} from '../../src/core/explanation.ts';
import {
  TELEGRAM_MAX_TEXT_CHARS,
  buildBlockedSiteMessage,
  buildEditMessageBody,
  buildInlineKeyboardForUrl,
  buildTelegramNoticeRef,
  isMessageNotModified,
  parseSendResult,
  planNoticeRecovery,
  selectNoticeVariant,
  toBlockedSiteMessageInput,
  urlToCallbackData,
  type BlockedSiteMessageInput,
} from '../../src/core/telegram-block-message.ts';
import type { ClassificationResult, GenerativeState, TelegramNoticeRef } from '../../src/types/index.ts';

// ── helpers ────────────────────────────────────────────────────────────────

const SENT_AT = new Date(2026, 9, 31, 12, 34, 56).getTime(); // local time: the timestamp text is TZ independent
const SENT_AT_TEXT = '2026-10-31 12:34:56';
const PENDING_LINE = '⏳ _Preparing explanation…_';
const SPECIALS = '_*[]()~`';

interface GoldenCase {
  id: string;
  input: Omit<BlockedSiteMessageInput, 'pending' | 'sentAt'>;
  text: string;
}

const golden = JSON.parse(
  readFileSync(new URL('./fixtures/telegram-restricted-golden.json', import.meta.url), 'utf8'),
) as { sentAt: [number, number, number, number, number, number]; cases: GoldenCase[] };

function goldenSentAt(): number {
  const [y, mo, d, h, mi, s] = golden.sentAt;
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

function cls(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    isEducational: false,
    category: 'Games',
    reason: 'Category "Games" is blocked in the settings.',
    safetyLevel: 'Medium',
    isAgeAppropriate: true,
    suggestedUrl: null,
    noUrlReason: null,
    ...overrides,
  };
}

function input(overrides: Partial<BlockedSiteMessageInput> = {}): BlockedSiteMessageInput {
  return {
    userProfile: 'Alex',
    title: 'Play games',
    url: 'https://games.example.com/play',
    reasonCode: 'content-restricted',
    matchedPattern: null,
    classification: cls(),
    pending: false,
    sentAt: SENT_AT,
    ...overrides,
  };
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/** Counts specials that are not preceded by a (non-escaped) backslash. */
function unescapedSpecials(text: string, chars = SPECIALS): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') {
      i++; // the next character is escaped
    } else if (chars.includes(text[i])) {
      n++;
    }
  }
  return n;
}

function endsWithDanglingBackslash(text: string): boolean {
  const m = /\\+$/.exec(text);
  return m !== null && m[0].length % 2 === 1;
}

/** Removes backslashes that escape a special; anything left is a stray backslash. */
function unescape(text: string): string {
  return text.replace(/\\([_*[\]()~`])/g, '$1');
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

// ── AC32: layouts ──────────────────────────────────────────────────────────

describe('buildBlockedSiteMessage — plain variant is byte-identical to HEAD (golden strings)', () => {
  for (const c of golden.cases) {
    it(`${c.id}`, () => {
      const out = buildBlockedSiteMessage({
        ...c.input,
        classification: c.input.classification as ClassificationResult | null,
        pending: false,
        sentAt: goldenSentAt(),
      });
      assert.equal(out, c.text);
    });
  }

  it('the golden set covers a classified block, an unclassified block, with and without title', () => {
    const ids = golden.cases.map((c) => c.id);
    assert.ok(ids.includes('classifiedGames'));
    assert.ok(ids.includes('patternTitled'));
    assert.ok(ids.includes('patternNoTitle'));
    assert.equal(golden.cases.filter((c) => c.input.classification !== null).length >= 3, true);
  });

  it('a classification flagged as an error is laid out like an unclassified block', () => {
    const base = golden.cases.find((c) => c.id === 'patternTitled');
    assert.ok(base);
    const withError = buildBlockedSiteMessage({
      ...base.input,
      classification: cls({ error: true, category: 'error', reason: 'boom' }),
      pending: false,
      sentAt: goldenSentAt(),
    });
    assert.equal(withError, base.text);
  });

  it('the timestamp is the zero-padded local time of sentAt', () => {
    const out = buildBlockedSiteMessage(input({ sentAt: new Date(2026, 0, 5, 3, 4, 5).getTime() }));
    assert.ok(out.endsWith('🕐 2026-01-05 03:04:05'), out.slice(-40));
  });
});

describe('buildBlockedSiteMessage — pending variant', () => {
  const synthesized = cls();
  const pending = buildBlockedSiteMessage(input({ pending: true, classification: synthesized }));
  const plain = buildBlockedSiteMessage(input({ pending: false, classification: synthesized }));

  it('contains the pending paragraph exactly once, between the reason and the timestamp', () => {
    assert.equal(count(pending, PENDING_LINE), 1);
    assert.ok(
      pending.includes(`📝 *Reason:*\nCategory "Games" is blocked in the settings.\n\n${PENDING_LINE}\n\n🕐 ${SENT_AT_TEXT}`),
      pending,
    );
  });

  it('uses the synthesized reason and has no Suggested Educational Resource line', () => {
    assert.ok(pending.includes('Category "Games" is blocked in the settings.'));
    assert.equal(pending.includes('Suggested Educational Resource'), false);
  });

  it('differs from the plain layout only by the missing suggestion bullet and the pending paragraph', () => {
    assert.ok(plain.includes('   • Suggested Educational Resource: Not specified\n'));
    const expected = plain
      .replace('   • Suggested Educational Resource: Not specified\n', '')
      .replace('\n\n🕐 ', `\n\n${PENDING_LINE}\n\n🕐 `);
    assert.equal(pending, expected);
  });

  it('the plain variant never contains the pending paragraph', () => {
    assert.equal(plain.includes('Preparing explanation'), false);
  });
});

describe('buildBlockedSiteMessage — final and fallback layouts (data-driven)', () => {
  it('final with a validated URL: model reason and the URL, no pending paragraph', () => {
    const out = buildBlockedSiteMessage(
      input({ classification: cls({ reason: 'This is a gaming portal.', suggestedUrl: 'https://www.khanacademy.org/math' }) }),
    );
    assert.ok(out.includes('   • Suggested Educational Resource: https://www.khanacademy.org/math\n'));
    assert.ok(out.includes('📝 *Reason:*\nThis is a gaming portal.\n\n🕐'));
    assert.equal(out.includes('Preparing explanation'), false);
  });

  it('final without a URL: Not specified (<noUrlReason>)', () => {
    const out = buildBlockedSiteMessage(
      input({ classification: cls({ reason: 'Model says.', noUrlReason: 'No valid educational link could be suggested.' }) }),
    );
    assert.ok(out.includes('   • Suggested Educational Resource: Not specified (No valid educational link could be suggested.)\n'), out);
  });

  it('final for an Educational category shows the explanatory note', () => {
    const out = buildBlockedSiteMessage(
      input({ classification: cls({ category: 'Educational', noUrlReason: 'Already educational; no alternate resource suggested.' }) }),
    );
    assert.ok(out.includes('Not specified (Already educational; no alternate resource suggested.)'));
  });

  it('fallback: synthesized reason and Not specified (Explanation unavailable.)', () => {
    const out = buildBlockedSiteMessage(input({ classification: cls({ noUrlReason: 'Explanation unavailable.' }) }));
    assert.ok(out.includes('📝 *Reason:*\nCategory "Games" is blocked in the settings.\n'));
    assert.ok(out.includes('   • Suggested Educational Resource: Not specified (Explanation unavailable.)\n'));
    assert.equal(out.includes('Preparing explanation'), false);
  });
});

describe('buildBlockedSiteMessage — one notice, one header', () => {
  it('pending, plain, final and fallback share header, title, URL, restriction and timestamp lines', () => {
    const variants = [
      input({ pending: true }),
      input({ pending: false }),
      input({ classification: cls({ reason: 'Model reason.', suggestedUrl: 'https://www.khanacademy.org/math' }) }),
      input({ classification: cls({ noUrlReason: 'Explanation unavailable.' }) }),
    ].map((i) => buildBlockedSiteMessage(i));
    const shared = (text: string): string[] =>
      text.split('\n').filter((l) => /^(🚫|📄|🔗|📝 \*Restriction|\*Access|\*Detection|🕐)/.test(l));
    const reference = shared(variants[0]);
    assert.ok(reference.length >= 6, reference.join('|'));
    for (const v of variants) {
      assert.deepEqual(shared(v), reference);
    }
    assert.ok(reference.at(-1)?.endsWith(SENT_AT_TEXT));
  });

  it('a later edit built with the same sentAt only differs in content, never in timestamp', () => {
    const first = buildBlockedSiteMessage(input({ pending: true }));
    const edited = buildBlockedSiteMessage(input({ classification: cls({ reason: 'New reason.' }) }));
    assert.equal(first.split('\n').at(-1), edited.split('\n').at(-1));
  });
});

describe('toBlockedSiteMessageInput', () => {
  it('maps notifier arguments to the builder input', () => {
    const c = cls();
    const out = toBlockedSiteMessageInput(
      { userProfileName: 'Alex' },
      { url: 'https://a.org/x', reason: 'content-restricted', matchedPattern: 'a.org', pageTitle: 'T', classification: c, pending: true, sentAt: 5 },
    );
    assert.deepEqual(out, {
      userProfile: 'Alex',
      title: 'T',
      url: 'https://a.org/x',
      reasonCode: 'content-restricted',
      matchedPattern: 'a.org',
      classification: c,
      pending: true,
      sentAt: 5,
    });
  });

  it('missing optional values become empty title, null pattern and null classification', () => {
    const out = toBlockedSiteMessageInput({ userProfileName: '' }, { url: 'u', reason: 'restricted', pending: false, sentAt: 1 });
    assert.equal(out.title, '');
    assert.equal(out.matchedPattern ?? null, null);
    assert.equal(out.classification, null);
  });
});

// ── AC33: sanitising and escaping ──────────────────────────────────────────

describe('buildBlockedSiteMessage — sanitising and escaping (AC33)', () => {
  const NASTY = 'a_b*c[d]e(f)g~h`i\\j\nk\u0000l\u0007m';

  /** The text of one labelled single-line field. */
  function fieldAfter(text: string, label: string): string {
    const line = text.split('\n').find((l) => l.startsWith(label));
    assert.ok(line !== undefined, `no line starting with ${JSON.stringify(label)} in\n${text}`);
    return line.slice(label.length);
  }

  function checkSegment(name: string, segment: string): void {
    assert.equal(CONTROL.test(segment), false, `${name}: control character in ${JSON.stringify(segment)}`);
    assert.equal(unescapedSpecials(segment), 0, `${name}: unescaped special in ${JSON.stringify(segment)}`);
    assert.equal(unescape(segment).includes('\\'), false, `${name}: stray backslash in ${JSON.stringify(segment)}`);
    for (const letter of 'abcdefghijklm') {
      assert.ok(segment.includes(letter), `${name}: lost the letter ${letter}`);
    }
  }

  it('title, URL and matched pattern are neutralised', () => {
    const out = buildBlockedSiteMessage(
      input({ title: NASTY, url: `https://x.example/${NASTY}`, matchedPattern: NASTY, classification: cls() }),
    );
    checkSegment('title', fieldAfter(out, '📄 *Title:* '));
    checkSegment('url', fieldAfter(out, '🔗 *URL:* ').replace('https://x.example/', ''));
    checkSegment('pattern', fieldAfter(out, '🔍 *Pattern:* '));
  });

  it('model reason and suggested URL are neutralised', () => {
    const out = buildBlockedSiteMessage(
      input({ classification: cls({ reason: NASTY, suggestedUrl: `https://x.example/${NASTY}` }) }),
    );
    const lines = out.split('\n');
    const reasonAt = lines.indexOf('📝 *Reason:*');
    assert.ok(reasonAt > 0);
    checkSegment('reason', lines[reasonAt + 1]);
    checkSegment('suggested url', fieldAfter(out, '   • Suggested Educational Resource: ').replace('https://x.example/', ''));
  });

  it('a model noUrlReason is neutralised', () => {
    const out = buildBlockedSiteMessage(input({ classification: cls({ noUrlReason: NASTY }) }));
    const raw = fieldAfter(out, '   • Suggested Educational Resource: Not specified (');
    assert.ok(raw.endsWith(')'), raw);
    checkSegment('noUrlReason', raw.slice(0, -1));
  });

  it('the pending layout neutralises the same fields', () => {
    const out = buildBlockedSiteMessage(input({ pending: true, title: NASTY, classification: cls({ reason: NASTY }) }));
    checkSegment('title', fieldAfter(out, '📄 *Title:* '));
    const lines = out.split('\n');
    checkSegment('reason', lines[lines.indexOf('📝 *Reason:*') + 1]);
  });

  it('a user profile with specials cannot break the header entity', () => {
    const out = buildBlockedSiteMessage(input({ userProfile: 'Al*ex_[x]' }));
    const header = out.split('\n')[0];
    assert.equal(unescapedSpecials(header, '*'), 4, header); // *Site Access Restricted* and the *user* bold
    assert.equal(unescapedSpecials(header, '_[]'), 0, header);
  });

  it('the whole message has no control character other than newlines', () => {
    const out = buildBlockedSiteMessage(
      input({ title: NASTY, url: `https://x.example/${NASTY}`, matchedPattern: NASTY, classification: cls({ reason: NASTY, noUrlReason: NASTY }) }),
    );
    assert.equal(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(out), false);
  });
});

// ── AC34: length ───────────────────────────────────────────────────────────

describe('buildBlockedSiteMessage — length and entities (AC34)', () => {
  const FIVE_K = '*_'.repeat(2500);

  const stress: Array<[string, BlockedSiteMessageInput]> = [
    ['plain, URL suggested', input({
      title: FIVE_K, url: `https://x.example/${FIVE_K}`, matchedPattern: FIVE_K,
      classification: cls({ reason: FIVE_K, noUrlReason: FIVE_K, suggestedUrl: `https://x.example/${FIVE_K}`, category: FIVE_K, safetyLevel: FIVE_K }),
    })],
    ['plain, no URL, noUrlReason', input({
      title: FIVE_K, url: `https://x.example/${FIVE_K}`, matchedPattern: FIVE_K,
      classification: cls({ reason: FIVE_K, noUrlReason: FIVE_K, category: FIVE_K, safetyLevel: FIVE_K }),
    })],
    ['pending', input({
      pending: true, title: FIVE_K, url: `https://x.example/${FIVE_K}`, matchedPattern: FIVE_K,
      classification: cls({ reason: FIVE_K, category: FIVE_K, safetyLevel: FIVE_K }),
    })],
    ['restricted-list reason with a classification', input({
      reasonCode: 'restricted', title: FIVE_K, url: `https://x.example/${FIVE_K}`, matchedPattern: FIVE_K,
      classification: cls({ reason: FIVE_K, noUrlReason: FIVE_K, category: FIVE_K, safetyLevel: FIVE_K }),
    })],
    ['unclassified pattern block', input({
      reasonCode: 'restricted', title: FIVE_K, url: `https://x.example/${FIVE_K}`, matchedPattern: FIVE_K, classification: null,
    })],
    ['very long user name', input({ userProfile: FIVE_K, title: FIVE_K, classification: cls({ reason: FIVE_K }) })],
  ];

  for (const [name, i] of stress) {
    it(`${name}: at most 4096 characters, balanced entities, no dangling backslash, Reason kept`, () => {
      const out = buildBlockedSiteMessage(i);
      assert.ok(out.length <= TELEGRAM_MAX_TEXT_CHARS, `length ${out.length}`);
      assert.equal(endsWithDanglingBackslash(out), false);
      assert.equal(unescapedSpecials(out, '*') % 2, 0, 'even number of unescaped *');
      assert.equal(unescapedSpecials(out, '_') % 2, 0, 'even number of unescaped _');
      assert.ok(out.includes('*Reason:*'), 'Reason section survives');
    });
  }

  it('TELEGRAM_MAX_TEXT_CHARS is 4096', () => {
    assert.equal(TELEGRAM_MAX_TEXT_CHARS, 4096);
  });

  describe('degrade order when the text does not fit', () => {
    const REASON = 'R'.repeat(400);
    const base = input({
      userProfile: 'Alex',
      title: 'A long page title that is still reasonable',
      url: 'https://games.example.com/play/level/1',
      matchedPattern: 'games.example.com/*',
      classification: cls({ reason: REASON, noUrlReason: 'No educational equivalent exists for this kind of page.' }),
    });
    const full = buildBlockedSiteMessage(base);

    const features = {
      pattern: (t: string) => t.includes('🔍 *Pattern:*'),
      noUrlReason: (t: string) => t.includes('Not specified ('),
      detailLines: (t: string) => t.includes('• Category:'),
      fullReason: (t: string) => t.includes(REASON),
    } as const;

    it('everything is present when the text fits', () => {
      for (const check of Object.values(features)) assert.equal(check(full), true);
      assert.equal(buildBlockedSiteMessage(base, full.length), full);
    });

    it('as room shrinks: pattern line first, then the noUrlReason, then the detail lines, then the reason is cut', () => {
      const lostAt: Record<keyof typeof features, number | null> = { pattern: null, noUrlReason: null, detailLines: null, fullReason: null };
      let reasonEverEmpty = false;
      for (let max = full.length; max >= 500; max -= 5) {
        const out = buildBlockedSiteMessage(base, max);
        assert.ok(out.length <= max, `max ${max}: got ${out.length}`);
        assert.ok(out.includes('*Reason:*'), `max ${max}: Reason survives`);
        assert.equal(endsWithDanglingBackslash(out), false, `max ${max}`);
        assert.equal(unescapedSpecials(out, '*') % 2, 0, `max ${max}: balanced *`);
        assert.equal(unescapedSpecials(out, '_') % 2, 0, `max ${max}: balanced _`);
        const reasonLine = out.split('\n')[out.split('\n').indexOf('📝 *Reason:*') + 1] ?? '';
        if (reasonLine.trim() === '') reasonEverEmpty = true;
        for (const [name, check] of Object.entries(features) as Array<[keyof typeof features, (t: string) => boolean]>) {
          if (!check(out) && lostAt[name] === null) lostAt[name] = max;
          if (check(out)) assert.equal(lostAt[name], null, `${name} came back at ${max} after being dropped`);
        }
      }
      assert.equal(reasonEverEmpty, false, 'the reason is cut, never removed');
      for (const [name, at] of Object.entries(lostAt)) assert.notEqual(at, null, `${name} was never dropped down to 500 characters`);
      const { pattern, noUrlReason, detailLines, fullReason } = lostAt as Record<keyof typeof features, number>;
      assert.ok(pattern >= noUrlReason, `pattern (${pattern}) before noUrlReason (${noUrlReason})`);
      assert.ok(noUrlReason >= detailLines, `noUrlReason (${noUrlReason}) before detail lines (${detailLines})`);
      assert.ok(detailLines >= fullReason, `detail lines (${detailLines}) before reason cut (${fullReason})`);
    });
  });
});

// ── AC35: keyboard and edit body ───────────────────────────────────────────

describe('buildInlineKeyboardForUrl / urlToCallbackData (unchanged from HEAD)', () => {
  it('three buttons in two rows with allow:/restrict:/ignore: and the hostname without www.', () => {
    assert.deepEqual(buildInlineKeyboardForUrl('https://www.example.com/some/path?q=1'), {
      inline_keyboard: [
        [
          { text: '➕ Add to Allowed', callback_data: 'allow:example.com' },
          { text: '➕ Add to Restricted', callback_data: 'restrict:example.com' },
        ],
        [{ text: '➕ Add to Ignored', callback_data: 'ignore:example.com' }],
      ],
    });
  });

  it('a hostname without www is kept, a bare host without scheme works', () => {
    assert.equal(urlToCallbackData('https://games.example.com/x'), 'games.example.com');
    assert.equal(urlToCallbackData('example.com/path'), 'example.com');
    assert.equal(urlToCallbackData('https://WWW.Example.com'), 'example.com');
  });

  it('the hostname is cut to 50 characters (callback_data limit)', () => {
    const host = 'a'.repeat(60) + '.com';
    const data = urlToCallbackData(`https://${host}/`);
    assert.equal(data.length, 50);
    assert.equal(data, host.slice(0, 50));
    assert.ok(buildInlineKeyboardForUrl(`https://${host}/`).inline_keyboard[0][0].callback_data.length <= 64);
  });

  it('an unparseable input falls back to the raw text, cut to 50', () => {
    assert.equal(urlToCallbackData('http://'), 'http://');
    assert.equal(urlToCallbackData('http://' + 'x'.repeat(80) + ' bad host').length, 50);
  });
});

describe('buildEditMessageBody', () => {
  const keyboard = buildInlineKeyboardForUrl('https://games.example.com/');

  it('carries chat, message, text and parse mode', () => {
    const body = buildEditMessageBody(42, 7, 'hello', 'Markdown', keyboard);
    assert.equal(body.chat_id, 42);
    assert.equal(body.message_id, 7);
    assert.equal(body.text, 'hello');
    assert.equal(body.parse_mode, 'Markdown');
  });

  it('includes the supplied keyboard (as the JSON string the Bot API takes)', () => {
    const body = buildEditMessageBody('42', 7, 't', 'Markdown', keyboard);
    assert.deepEqual(JSON.parse(body.reply_markup), keyboard);
  });

  it('without a keyboard it sends an empty one, as the existing button-press flow expects', () => {
    const body = buildEditMessageBody('42', 7, 't', 'Markdown');
    assert.equal(body.reply_markup, '{"inline_keyboard":[]}');
  });
});

describe('buildTelegramNoticeRef', () => {
  const base = { chatId: '42', messageId: 7, url: 'https://games.example.com/play', text: 'pending text', fallbackText: 'fallback text' };

  it('stores keyboardUrl iff Telegram commands were on when the message was sent', () => {
    assert.equal(buildTelegramNoticeRef({ ...base, enableTelegramCommands: true }).keyboardUrl, 'https://games.example.com/play');
    assert.equal(buildTelegramNoticeRef({ ...base, enableTelegramCommands: false }).keyboardUrl, null);
  });

  it('describes the message and the texts, not yet finalized', () => {
    assert.deepEqual(buildTelegramNoticeRef({ ...base, enableTelegramCommands: false }), {
      chatId: '42',
      messageId: 7,
      keyboardUrl: null,
      finalized: false,
      text: 'pending text',
      fallbackText: 'fallback text',
    });
  });
});

// ── AC36 ───────────────────────────────────────────────────────────────────

describe('isMessageNotModified', () => {
  it('recognises Telegram\'s "message is not modified" answer, case-insensitively', () => {
    assert.equal(
      isMessageNotModified(
        'Bad Request: message is not modified: specified new message content and reply markup are exactly the same as a current content and reply markup of the message',
      ),
      true,
    );
    assert.equal(isMessageNotModified('BAD REQUEST: MESSAGE IS NOT MODIFIED'), true);
  });

  it('other errors are not "not modified"', () => {
    assert.equal(isMessageNotModified('Bad Request: message to edit not found'), false);
    assert.equal(isMessageNotModified("Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 12"), false);
    assert.equal(isMessageNotModified('Forbidden: bot was blocked by the user'), false);
  });

  it('empty and missing descriptions are false', () => {
    assert.equal(isMessageNotModified(''), false);
    assert.equal(isMessageNotModified(undefined), false);
    assert.equal(isMessageNotModified(null), false);
  });
});

describe('parseSendResult', () => {
  it('reads message_id from a successful sendMessage answer', () => {
    assert.deepEqual(parseSendResult('{"ok":true,"result":{"message_id":42,"chat":{"id":1},"text":"x"}}'), { messageId: 42 });
  });

  it('a missing or non-numeric message_id gives null (the send still counts as delivered)', () => {
    for (const body of [
      '{"ok":true,"result":{}}',
      '{"ok":true}',
      '{"ok":true,"result":{"message_id":"42"}}',
      '{"ok":true,"result":{"message_id":null}}',
      '{"ok":true,"result":null}',
      '[]',
      'null',
    ]) {
      assert.deepEqual(parseSendResult(body), { messageId: null }, body);
    }
  });

  it('a body that is not JSON gives null', () => {
    assert.deepEqual(parseSendResult('<html>502</html>'), { messageId: null });
    assert.deepEqual(parseSendResult(''), { messageId: null });
  });
});

// ── AC37 (variant selection) ───────────────────────────────────────────────

describe('selectNoticeVariant', () => {
  it('not eligible -> none, whatever the plan says', () => {
    assert.equal(selectNoticeVariant({ eligible: false, planned: true }), 'none');
    assert.equal(selectNoticeVariant({ eligible: false, planned: false }), 'none');
  });

  it('eligible and this event owns Stage 2 -> pending', () => {
    assert.equal(selectNoticeVariant({ eligible: true, planned: true }), 'pending');
  });

  it('eligible without Stage 2 -> plain', () => {
    assert.equal(selectNoticeVariant({ eligible: true, planned: false }), 'plain');
  });
});

// ── AC38: recovery ─────────────────────────────────────────────────────────

describe('planNoticeRecovery', () => {
  const NOW = 1_800_000_000_000;

  function ref(overrides: Partial<TelegramNoticeRef> = {}): TelegramNoticeRef {
    return {
      chatId: '42',
      messageId: 7,
      keyboardUrl: 'https://games.example.com/play',
      finalized: false,
      text: 'FINAL TEXT',
      fallbackText: 'FALLBACK TEXT',
      ...overrides,
    };
  }

  function gen(status: GenerativeState['status'], attemptedAt: number, telegram?: TelegramNoticeRef): GenerativeState {
    return { status, attemptedAt, telegram };
  }

  it('nothing to do without a generative state or a notice reference', () => {
    assert.deepEqual(planNoticeRecovery(undefined, NOW), { action: 'none' });
    assert.deepEqual(planNoticeRecovery(gen('done', NOW - 1000), NOW), { action: 'none' });
    assert.deepEqual(planNoticeRecovery({ status: 'pending', attemptedAt: NOW - 999_999 }, NOW), { action: 'none' });
  });

  it('a finalized notice is left alone in every status', () => {
    for (const status of ['pending', 'done', 'failed'] as const) {
      const g = gen(status, NOW - 10 * EXPLANATION_STALE_PENDING_MS, ref({ finalized: true, text: undefined, fallbackText: undefined }));
      assert.deepEqual(planNoticeRecovery(g, NOW), { action: 'none' }, status);
    }
  });

  it('done and failed but not finalized -> edit to the stored text, status untouched', () => {
    for (const status of ['done', 'failed'] as const) {
      const out = planNoticeRecovery(gen(status, NOW - 5000, ref()), NOW);
      assert.equal(out.action, 'edit', status);
      if (out.action !== 'edit') return;
      assert.equal(out.text, 'FINAL TEXT');
      assert.equal(out.keyboardUrl, 'https://games.example.com/play');
      assert.equal(out.markFailed, false);
      assert.equal(out.ref.messageId, 7);
      assert.equal(out.ref.chatId, '42');
    }
  });

  it('pending and stale (>= 30 s) -> edit to the fallback text and mark the attempt failed', () => {
    for (const age of [EXPLANATION_STALE_PENDING_MS, EXPLANATION_STALE_PENDING_MS + 1, 3_600_000]) {
      const out = planNoticeRecovery(gen('pending', NOW - age, ref()), NOW);
      assert.equal(out.action, 'edit', `age ${age}`);
      if (out.action !== 'edit') return;
      assert.equal(out.text, 'FALLBACK TEXT');
      assert.equal(out.markFailed, true);
      assert.equal(out.keyboardUrl, 'https://games.example.com/play');
    }
  });

  it('pending and fresh (< 30 s) -> none: the owning worker is still running', () => {
    assert.deepEqual(planNoticeRecovery(gen('pending', NOW - (EXPLANATION_STALE_PENDING_MS - 1), ref()), NOW), { action: 'none' });
    assert.deepEqual(planNoticeRecovery(gen('pending', NOW, ref()), NOW), { action: 'none' });
  });

  it('keyboardUrl null is carried through (commands were off)', () => {
    const out = planNoticeRecovery(gen('done', NOW - 1, ref({ keyboardUrl: null })), NOW);
    assert.equal(out.action, 'edit');
    if (out.action === 'edit') assert.equal(out.keyboardUrl, null);
  });

  it('is idempotent: the same input gives the same plan, and the input is not changed', () => {
    const g = gen('pending', NOW - 2 * EXPLANATION_STALE_PENDING_MS, ref());
    const snapshot = JSON.parse(JSON.stringify(g));
    const first = planNoticeRecovery(g, NOW);
    const second = planNoticeRecovery(g, NOW);
    assert.deepEqual(first, second);
    assert.deepEqual(g, snapshot);
  });
});
