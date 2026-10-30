import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseTelegramInput, type ParsedTelegramInput } from '../../src/core/telegram-input.ts';

function table(rows: Array<[input: string, expected: ParsedTelegramInput | null]>): void {
  for (const [input, expected] of rows) {
    it(`${JSON.stringify(input)} -> ${expected ? expected.kind : 'null'}`, () => {
      assert.deepEqual(parseTelegramInput(input), expected);
    });
  }
}

describe('parseTelegramInput', () => {
  describe('help and cache info', () => {
    table([
      ['/help', { kind: 'help' }],
      ['/commands', { kind: 'help' }],
      ['/start', { kind: 'help' }],
      ['/HELP', { kind: 'help' }],
      ['/help@FocusBot', { kind: 'help' }],
      ['  /help  ', { kind: 'help' }],
      ['/cache_info', { kind: 'cache_info' }],
      ['/cacheinfo', { kind: 'cache_info' }],
    ]);
  });

  describe('list commands', () => {
    table([
      ['/list_allow', { kind: 'list', list: 'allowed' }],
      ['/list_allowed', { kind: 'list', list: 'allowed' }],
      ['/list_restrict', { kind: 'list', list: 'restricted' }],
      ['/list_restricted', { kind: 'list', list: 'restricted' }],
      ['/list_ignore', { kind: 'list', list: 'ignored' }],
      ['/LIST_IGNORED', { kind: 'list', list: 'ignored' }],
    ]);
  });

  describe('remove commands keep the raw pattern text', () => {
    table([
      ['/remove_allow example.com', { kind: 'remove', list: 'allowed', patternRaw: 'example.com' }],
      ['/remove_restrict https://www.youtube.com/x', { kind: 'remove', list: 'restricted', patternRaw: 'https://www.youtube.com/x' }],
      ['/remove_ignore@FocusBot  *.foo.com ', { kind: 'remove', list: 'ignored', patternRaw: '*.foo.com' }],
      ['/remove_allow', null],
    ]);
  });

  describe('clear commands need the word "confirm"', () => {
    table([
      ['/clear_allow', { kind: 'clear_list', list: 'allowed', confirmed: false }],
      ['/clear_restrict confirm', { kind: 'clear_list', list: 'restricted', confirmed: true }],
      ['/clear_ignore CONFIRM', { kind: 'clear_list', list: 'ignored', confirmed: true }],
      ['/clear_ignore yes', { kind: 'clear_list', list: 'ignored', confirmed: false }],
      ['/clear_cache', { kind: 'clear_cache', confirmed: false }],
      ['/clearcache confirm', { kind: 'clear_cache', confirmed: true }],
    ]);
  });

  describe('add commands normalise the argument with urlToPattern', () => {
    table([
      ['/allow https://www.youtube.com/watch?v=1', { kind: 'add', list: 'allowed', pattern: '*.youtube.com' }],
      ['/restrict example.com', { kind: 'add', list: 'restricted', pattern: '*.example.com' }],
      ['/ignore *.foo.com', { kind: 'add', list: 'ignored', pattern: '*.foo.com' }],
      ['/allow@FocusBot example.com', { kind: 'add', list: 'allowed', pattern: '*.example.com' }],
      ['/allow', null],
      ['/restrict   ', null],
    ]);
  });

  describe('callback data from inline buttons: action:value', () => {
    table([
      ['allow:https://example.com', { kind: 'add', list: 'allowed', pattern: '*.example.com' }],
      ['restrict:youtube.com', { kind: 'add', list: 'restricted', pattern: '*.youtube.com' }],
      ['IGNORE:youtube.com', { kind: 'add', list: 'ignored', pattern: '*.youtube.com' }],
      ['allow:', null],
      [':example.com', null],
      ['delete:example.com', null],
    ]);
  });

  describe('input that is not a command', () => {
    table([
      ['', null],
      ['   ', null],
      ['hello', null],
      ['/', null],
      ['/unknown', null],
      ['/list_foo', null],
      ['/allow2 example.com', null],
    ]);
  });

  describe('current behaviour: arguments the command does not use are ignored', () => {
    table([
      ['/list_allow now please', { kind: 'list', list: 'allowed' }],
      ['/help me', { kind: 'help' }],
    ]);
  });
});
