import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { capText, escapeMarkdown, sanitizeModelText } from '../../src/core/telegram-markdown.ts';

const SPECIALS = ['_', '*', '[', ']', '(', ')', '~', '`'];

describe('escapeMarkdown', () => {
  it('puts one backslash before each of _ * [ ] ( ) ~ `', () => {
    for (const ch of SPECIALS) {
      assert.equal(escapeMarkdown(`a${ch}b`), `a\\${ch}b`, ch);
    }
  });

  it('escapes every occurrence, in a mixed string', () => {
    assert.equal(escapeMarkdown('_*[]()~`'), '\\_\\*\\[\\]\\(\\)\\~\\`');
    assert.equal(escapeMarkdown('a_b_c'), 'a\\_b\\_c');
  });

  it('leaves everything else alone (letters, digits, punctuation, emoji, existing backslashes)', () => {
    const plain = 'Hello, World! 123 - — . : ; # + = <> {} | / ? @ & % $ ^ 😀 \\';
    assert.equal(escapeMarkdown(plain), plain);
  });

  it('is the empty string for the empty string', () => {
    assert.equal(escapeMarkdown(''), '');
  });
});

describe('sanitizeModelText', () => {
  it('turns control characters into spaces', () => {
    assert.equal(sanitizeModelText('a\nb\tc\u0000d\u0007e\u007ff\u0085g'), 'a b c d e f g');
  });

  it('removes backslashes', () => {
    assert.equal(sanitizeModelText('a\\b\\\\c\\_d'), 'abc_d');
  });

  it('keeps all other text, including Markdown specials (escaping is a separate step)', () => {
    assert.equal(sanitizeModelText('*bold* _it_ [x](y) ~s~ `c`'), '*bold* _it_ [x](y) ~s~ `c`');
  });

  it('sanitising then escaping leaves no model-supplied backslash and no control character', () => {
    const out = escapeMarkdown(sanitizeModelText('x\\_y\n*z*\u0000'));
    assert.equal(/[\u0000-\u001f\u007f-\u009f]/.test(out), false);
    assert.equal(out, 'x\\_y \\*z\\* ');
  });
});

describe('capText', () => {
  it('text within the cap is unchanged', () => {
    assert.equal(capText('abc', 3), 'abc');
    assert.equal(capText('abc', 10), 'abc');
    assert.equal(capText('', 5), '');
  });

  it('longer text is cut to exactly the cap, ending with an ellipsis', () => {
    const out = capText('x'.repeat(500), 150);
    assert.equal(out.length, 150);
    assert.ok(out.endsWith('…'));
    assert.equal(out, 'x'.repeat(149) + '…');
  });

  it('never leaves half of a surrogate pair', () => {
    const emoji = '😀'.repeat(20);
    for (const cap of [4, 5, 6, 7, 10, 11]) {
      const out = capText(emoji, cap);
      assert.ok(out.length <= cap, `cap ${cap}: ${out.length}`);
      assert.equal(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(out), false, `cap ${cap}`);
    }
  });
});
