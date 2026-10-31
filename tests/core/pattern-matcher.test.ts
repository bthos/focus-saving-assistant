import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { matchesPattern } from '../../src/core/pattern-matcher.ts';

type Row = { pattern: string; url: string; expected: boolean };

function table(rows: Row[]): void {
  for (const { pattern, url, expected } of rows) {
    it(`${JSON.stringify(pattern)} ${expected ? 'matches' : 'does not match'} ${url}`, () => {
      assert.equal(matchesPattern(url, pattern), expected);
    });
  }
}

describe('matchesPattern', () => {
  describe('domain patterns', () => {
    table([
      { pattern: 'example.com', url: 'https://example.com/a', expected: true },
      { pattern: 'example.com', url: 'https://www.example.com/', expected: true },
      { pattern: 'example.com', url: 'https://example.com:8080/', expected: true },
      { pattern: 'example.com', url: 'https://example.org/', expected: false },
      { pattern: '*.example.com', url: 'https://a.example.com/', expected: true },
      { pattern: '*.example.com', url: 'https://a.b.example.com/', expected: true },
      { pattern: '*.example.com', url: 'https://example.com/', expected: true },
      { pattern: '*.example.com', url: 'https://notexample.com/', expected: false },
    ]);
  });

  describe('path patterns', () => {
    table([
      { pattern: 'example.com/*', url: 'https://example.com/a/b', expected: true },
      { pattern: 'example.com/*', url: 'https://sub.example.com/a', expected: true },
      { pattern: 'example.com/*', url: 'https://example.org/example.com/x', expected: false },
    ]);
  });

  describe('glob patterns', () => {
    table([
      { pattern: '*example.com*', url: 'https://www.example.com/', expected: true },
      { pattern: '*mid*', url: 'https://example.com/mid/x', expected: true },
      { pattern: '*mid*', url: 'https://example.com/x', expected: false },
    ]);
  });

  describe('full URL patterns', () => {
    table([
      { pattern: 'https://example.com/x', url: 'https://example.com/x', expected: true },
      { pattern: 'https://example.com/x', url: 'https://example.com/y', expected: false },
    ]);
  });

  describe('unparseable URL', () => {
    it('falls back to a substring test on the raw string', () => {
      assert.equal(matchesPattern('not a url', 'a url'), true);
      assert.equal(matchesPattern('not a url', 'zzz'), false);
    });
  });

  describe('current behaviour, see H1: bare tokens are substring matches on host and raw URL', () => {
    table([
      // restricted `x.com` over-blocks other sites
      { pattern: 'x.com', url: 'https://x.com/a', expected: true },
      { pattern: 'x.com', url: 'https://www.x.com/', expected: true },
      { pattern: 'x.com', url: 'https://www.netflix.com/', expected: true },
      { pattern: 'x.com', url: 'https://dropbox.com/', expected: true },
      // an allowed pattern found in another URL's query lets it through
      { pattern: 'example.com', url: 'https://evil.test/?r=example.com', expected: true },
      { pattern: 'go', url: 'https://google.com/', expected: true },
      // path pattern without wildcard is a prefix/substring test on the raw URL
      { pattern: 'example.com/a', url: 'https://example.com/a?x=1', expected: true },
      { pattern: 'example.com/a', url: 'https://example.com/a/b', expected: true },
      { pattern: 'example.com/a', url: 'https://other.com/example.com/a', expected: true },
    ]);
  });

  describe('current behaviour: degenerate patterns match everything', () => {
    table([
      { pattern: '', url: 'https://example.com/', expected: true },
      { pattern: '*', url: 'https://example.com/', expected: true },
    ]);
  });

  describe('current behaviour: pattern case is not normalised, hostname is', () => {
    table([
      { pattern: 'example.com', url: 'https://EXAMPLE.com/', expected: true },
      { pattern: 'EXAMPLE.COM', url: 'https://example.com/', expected: false },
    ]);
  });

  describe('current behaviour, see H3: glob metacharacters are not escaped', () => {
    it('a pattern that makes an invalid regex never throws; it falls back to a raw-URL substring test', () => {
      assert.equal(matchesPattern('https://example.com/', '*foo(bar'), false);
      assert.equal(matchesPattern('https://example.com/', '*.exa[mple.com'), false);
    });

    it('a metacharacter that still forms a valid regex acts as regex syntax, not literally', () => {
      // `*a+b*` was meant to match host `a+b.com` literally; `+` is a quantifier instead
      assert.equal(matchesPattern('https://a+b.com/', '*a+b*'), false);
      assert.equal(matchesPattern('https://aab.com/', '*a+b*'), true);
    });
  });
});
