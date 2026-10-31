import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { urlToPattern } from '../../src/core/url-to-pattern.ts';

function table(rows: Array<[input: string, expected: string]>): void {
  for (const [input, expected] of rows) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      assert.equal(urlToPattern(input), expected);
    });
  }
}

describe('urlToPattern', () => {
  describe('URLs and bare hosts become *.domain with www stripped', () => {
    table([
      ['https://www.youtube.com/watch?v=1', '*.youtube.com'],
      ['youtube.com', '*.youtube.com'],
      ['www.youtube.com', '*.youtube.com'],
      ['HTTPS://WWW.Example.COM/x', '*.example.com'],
      ['  https://m.youtube.com  ', '*.m.youtube.com'],
      ['http://localhost:3000/x', '*.localhost'],
    ]);
  });

  describe('path, query and port are dropped', () => {
    table([
      ['example.com/path?q=1', '*.example.com'],
      ['https://example.com:8443/a/b', '*.example.com'],
    ]);
  });

  describe('wildcard input without a protocol is kept as typed (trimmed)', () => {
    table([
      ['*.youtube.com', '*.youtube.com'],
      ['youtube.com/*', 'youtube.com/*'],
      ['  *foo  ', '*foo'],
    ]);
  });

  describe('empty input', () => {
    table([
      ['', ''],
      ['   ', ''],
    ]);
  });

  describe('unparseable input is returned sanitised', () => {
    table([
      ['not a url', 'not a url'],
      ['a b', 'a b'],
    ]);
  });

  describe('current behaviour: degenerate input yields a pattern that matches broadly', () => {
    // `https://` has no host, so it comes back as a literal pattern; matchesPattern treats it as a
    // substring and it then matches every https URL.
    table([['https://', 'https://']]);
  });

  describe('current behaviour: a wildcard URL with a protocol is parsed as a URL', () => {
    table([['https://*.foo.com', '*.*.foo.com']]);
  });
});
