/**
 * Telegram bot input grammar: slash commands and inline-button callback data -> typed intent.
 * Pure parsing only; executing the intent (settings, cache, replies) lives in background/telegram-commands.ts.
 */

import { urlToPattern } from './url-to-pattern.ts';

export type PatternListKind = 'allowed' | 'restricted' | 'ignored';

export type ParsedTelegramInput =
  | { kind: 'add'; list: PatternListKind; pattern: string }
  | { kind: 'list'; list: PatternListKind }
  | { kind: 'remove'; list: PatternListKind; patternRaw: string }
  | { kind: 'clear_list'; list: PatternListKind; confirmed: boolean }
  | { kind: 'clear_cache'; confirmed: boolean }
  | { kind: 'cache_info' }
  | { kind: 'help' };

/** Verb used in callback_data (`allow:<url>`) and in /allow, /restrict, /ignore. */
export type TelegramCommandAction = 'allow' | 'restrict' | 'ignore';

function addActionToListKind(action: TelegramCommandAction): PatternListKind {
  if (action === 'allow') return 'allowed';
  if (action === 'restrict') return 'restricted';
  return 'ignored';
}

/**
 * Parse callback_data: allow:https://example.com
 */
function parseCallbackAdd(text: string): ParsedTelegramInput | null {
  const colonIdx = text.indexOf(':');
  if (colonIdx <= 0) return null;
  const action = text.substring(0, colonIdx).toLowerCase();
  const value = text.substring(colonIdx + 1).trim();
  if ((action === 'allow' || action === 'restrict' || action === 'ignore') && value) {
    return {
      kind: 'add',
      list: addActionToListKind(action as TelegramCommandAction),
      pattern: urlToPattern(value),
    };
  }
  return null;
}

/**
 * Full command parser: lists, cache, help, and add patterns (/allow …).
 */
export function parseTelegramInput(text: string): ParsedTelegramInput | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  if (!trimmed.startsWith('/')) {
    return parseCallbackAdd(trimmed);
  }

  const slash = trimmed.match(
    /^\/([a-zA-Z_]+)(@[a-zA-Z0-9_]+)?(?:\s+(.*))?$/i
  );
  if (!slash) return null;

  const cmd = slash[1].toLowerCase();
  const rest = (slash[3] ?? '').trim();

  const listFromCmd = (prefix: string): PatternListKind | null => {
    if (prefix === 'allow' || prefix === 'allowed') return 'allowed';
    if (prefix === 'restrict' || prefix === 'restricted') return 'restricted';
    if (prefix === 'ignore' || prefix === 'ignored') return 'ignored';
    return null;
  };

  if (cmd === 'help' || cmd === 'commands' || cmd === 'start') {
    return { kind: 'help' };
  }

  if (cmd === 'cache_info' || cmd === 'cacheinfo') {
    return { kind: 'cache_info' };
  }

  const listMatch = cmd.match(/^list_(allow|restrict|ignore|allowed|restricted|ignored)$/i);
  if (listMatch) {
    const k = listFromCmd(listMatch[1].toLowerCase());
    if (k) return { kind: 'list', list: k };
  }

  const removeMatch = cmd.match(/^remove_(allow|restrict|ignore|allowed|restricted|ignored)$/i);
  if (removeMatch) {
    if (!rest) return null;
    const k = listFromCmd(removeMatch[1].toLowerCase());
    if (k) return { kind: 'remove', list: k, patternRaw: rest };
  }

  const clearMatch = cmd.match(/^clear_(allow|restrict|ignore|allowed|restricted|ignored)$/i);
  if (clearMatch) {
    const k = listFromCmd(clearMatch[1].toLowerCase());
    if (k) {
      const confirmed = rest.toLowerCase() === 'confirm';
      return { kind: 'clear_list', list: k, confirmed };
    }
  }

  if (cmd === 'clear_cache' || cmd === 'clearcache') {
    return { kind: 'clear_cache', confirmed: rest.toLowerCase() === 'confirm' };
  }

  if (cmd === 'allow' || cmd === 'restrict' || cmd === 'ignore') {
    if (!rest) return null;
    return {
      kind: 'add',
      list: addActionToListKind(cmd as TelegramCommandAction),
      pattern: urlToPattern(rest),
    };
  }

  return null;
}
