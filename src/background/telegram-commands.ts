/**
 * Telegram commands handler — long polling for list management, cache, and /allow|/restrict|/ignore.
 *
 * One BotFather bot (one token) per Chrome user profile.
 * Multiple profiles polling the same token share one getUpdates stream and are not supported.
 */

import type { Settings } from '../types';
import { getSettings, saveSettings, getClassificationCache } from '../utils/storage';
import { sendTelegramMessage, editTelegramMessageText, escapeMarkdown } from '../utils/telegram-notifier';
import { urlToPattern } from '../core/url-to-pattern.ts';
import { parseTelegramInput } from '../core/telegram-input.ts';
import type { PatternListKind, ParsedTelegramInput } from '../core/telegram-input.ts';
import { loadRestrictionRules } from './rules-manager';
import { STORAGE_KEYS } from '../utils/constants.js';
import { addSystemLog } from '../utils/system-logger';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

const CALLBACK_ANSWER_MAX_LEN = 200;
const TELEGRAM_MESSAGE_SAFE = 3800;

function truncateCallbackAnswer(text: string): string {
  if (text.length <= CALLBACK_ANSWER_MAX_LEN) return text;
  return text.slice(0, CALLBACK_ANSWER_MAX_LEN - 3) + '...';
}

function listKindToSettingsKey(list: PatternListKind): 'allowedPatterns' | 'restrictedPatterns' | 'ignoredPatterns' {
  if (list === 'allowed') return 'allowedPatterns';
  if (list === 'restricted') return 'restrictedPatterns';
  return 'ignoredPatterns';
}

function listKindToLabel(list: PatternListKind): string {
  if (list === 'allowed') return 'allowed';
  if (list === 'restricted') return 'restricted';
  return 'ignored';
}

/** Slash command base for /clear_allow etc. */
function clearListCommandName(list: PatternListKind): string {
  if (list === 'allowed') return 'clear_allow';
  if (list === 'restricted') return 'clear_restrict';
  return 'clear_ignore';
}

export interface CommandOutcome {
  success: boolean;
  /** Short summary for callback toast / edit suffix */
  summary: string;
  /** One or more chat messages (Markdown). If several, send in order. */
  messages: string[];
}

function patternsFromSettings(settings: Settings, list: PatternListKind): string[] {
  const key = listKindToSettingsKey(list);
  const arr = settings[key];
  return Array.isArray(arr) ? [...arr] : [];
}

function findPatternIndex(patterns: string[], raw: string): number {
  const normalized = urlToPattern(raw);
  let idx = patterns.indexOf(normalized);
  if (idx !== -1) return idx;
  idx = patterns.indexOf(raw.trim());
  if (idx !== -1) return idx;
  const lower = raw.trim().toLowerCase();
  return patterns.findIndex((p) => p.toLowerCase() === lower);
}

function buildHelpMessage(): string {
  return [
    '*Focus Saving - bot commands*',
    '',
    '*Lists*',
    '/list_allow - show allowed patterns',
    '/list_restrict - show restricted patterns',
    '/list_ignore - show ignored patterns',
    '',
    '*Add*',
    '/allow <url or pattern>',
    '/restrict <url or pattern>',
    '/ignore <url or pattern>',
    'In groups: /allow@YourBot <url or pattern>',
    '',
    '*Remove one entry*',
    '/remove_allow <pattern>',
    '/remove_restrict <pattern>',
    '/remove_ignore <pattern>',
    '',
    '*Clear entire list*',
    '/clear_allow confirm',
    '/clear_restrict confirm',
    '/clear_ignore confirm',
    '',
    '*Classification cache*',
    '/cache_info - entry count',
    '/clear_cache confirm - wipe AI classification cache',
    '',
    '/help - this message',
  ].join('\n');
}

function formatPatternListMessage(title: string, patterns: string[]): string[] {
  if (patterns.length === 0) {
    return [`*${escapeMarkdown(title)}*\n\n_(empty)_`];
  }
  const lines: string[] = [`*${escapeMarkdown(title)}*`, '', `_Count: ${patterns.length}_`, ''];
  for (const p of patterns) {
    lines.push('• `' + escapeMarkdown(p) + '`');
  }
  return chunkMarkdownMessages(lines.join('\n'));
}

/** Split long Markdown into Telegram-sized chunks on paragraph boundaries when possible */
function chunkMarkdownMessages(body: string): string[] {
  if (body.length <= TELEGRAM_MESSAGE_SAFE) return [body];
  const chunks: string[] = [];
  let start = 0;
  while (start < body.length) {
    let end = Math.min(start + TELEGRAM_MESSAGE_SAFE, body.length);
    if (end < body.length) {
      const slice = body.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('\n'));
      if (lastBreak > TELEGRAM_MESSAGE_SAFE * 0.3) {
        end = start + lastBreak;
      }
    }
    chunks.push(body.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}

async function executeTelegramInput(
  settings: Settings,
  input: ParsedTelegramInput
): Promise<CommandOutcome> {
  switch (input.kind) {
    case 'help': {
      return {
        success: true,
        summary: 'Help sent',
        messages: [buildHelpMessage()],
      };
    }

    case 'cache_info': {
      const cache = await getClassificationCache();
      const n = Object.keys(cache).length;
      return {
        success: true,
        summary: `${n} cache entries`,
        messages: [`*Classification cache*\n\nEntries: *${n}*`],
      };
    }

    case 'clear_cache': {
      if (!input.confirmed) {
        return {
          success: false,
          summary: 'Confirmation required',
          messages: [
            `To clear the classification cache, send:\n` + '`/clear_cache confirm`',
          ],
        };
      }
      await chrome.storage.local.set({ [STORAGE_KEYS.CLASSIFICATION_CACHE]: {} });
      return {
        success: true,
        summary: 'Cache cleared',
        messages: ['✅ *Classification cache cleared*'],
      };
    }

    case 'list': {
      const patterns = patternsFromSettings(settings, input.list);
      const title = `${listKindToLabel(input.list)} patterns`;
      return {
        success: true,
        summary: `${patterns.length} entries`,
        messages: formatPatternListMessage(title, patterns),
      };
    }

    case 'remove': {
      const key = listKindToSettingsKey(input.list);
      const patterns = patternsFromSettings(settings, input.list);
      const idx = findPatternIndex(patterns, input.patternRaw);
      if (idx === -1) {
        return {
          success: false,
          summary: 'Not found',
          messages: [
            `❌ Pattern not found in *${escapeMarkdown(listKindToLabel(input.list))}* list.\n\nTried: \`${escapeMarkdown(urlToPattern(input.patternRaw))}\` and raw input.`,
          ],
        };
      }
      const removed = patterns[idx];
      const next = patterns.filter((_, i) => i !== idx);
      const newSettings: Settings = { ...settings, [key]: next };
      await saveSettings(newSettings);
      await loadRestrictionRules();
      return {
        success: true,
        summary: `Removed ${removed}`,
        messages: [`✅ Removed from *${escapeMarkdown(listKindToLabel(input.list))}*:\n\`${escapeMarkdown(removed)}\``],
      };
    }

    case 'clear_list': {
      const patterns = patternsFromSettings(settings, input.list);
      const n = patterns.length;
      if (!input.confirmed) {
        return {
          success: false,
          summary: 'Confirmation required',
          messages: [
            `*${escapeMarkdown(listKindToLabel(input.list))}* list has *${n}* entr${n === 1 ? 'y' : 'ies'}.\n\n` +
              `To delete all, send:\n` +
              `\`/${clearListCommandName(input.list)} confirm\``,
          ],
        };
      }
      if (n === 0) {
        return {
          success: true,
          summary: 'Already empty',
          messages: [`✅ *${escapeMarkdown(listKindToLabel(input.list))}* list was already empty.`],
        };
      }
      const key = listKindToSettingsKey(input.list);
      const newSettings: Settings = { ...settings, [key]: [] };
      await saveSettings(newSettings);
      await loadRestrictionRules();
      return {
        success: true,
        summary: `Cleared ${n}`,
        messages: [`✅ Cleared *${n}* entr${n === 1 ? 'y' : 'ies'}* from *${escapeMarkdown(listKindToLabel(input.list))}*.`],
      };
    }

    case 'add': {
      const listName = listKindToLabel(input.list);
      const key = listKindToSettingsKey(input.list);
      const patterns: string[] = settings[key] || [];
      if (patterns.includes(input.pattern)) {
        return {
          success: false,
          summary: 'Already in list',
          messages: [`❌ \`${escapeMarkdown(input.pattern)}\` is already in the *${escapeMarkdown(listName)}* list`],
        };
      }
      const updated = [...patterns, input.pattern];
      const newSettings: Settings = { ...settings, [key]: updated };
      await saveSettings(newSettings);
      await loadRestrictionRules();
      return {
        success: true,
        summary: `Added ${input.pattern}`,
        messages: [`✅ Added \`${escapeMarkdown(input.pattern)}\` to *${escapeMarkdown(listName)}* list`],
      };
    }

    default:
      return {
        success: false,
        summary: 'Unknown',
        messages: ['❌ Unsupported command'],
      };
  }
}

/**
 * Poll Telegram for updates and process commands
 */
export async function pollTelegramUpdates(): Promise<void> {
  const settings = await getSettings();

  if (!settings.enableTelegramCommands) return;
  if (!settings.telegramBotToken || !settings.telegramChatId) return;

  const chatId = settings.telegramChatId;
  const token = settings.telegramBotToken;

  const stored = await chrome.storage.local.get([STORAGE_KEYS.LAST_TELEGRAM_UPDATE_ID]);
  const lastUpdateId = (stored[STORAGE_KEYS.LAST_TELEGRAM_UPDATE_ID] as number) || 0;
  const offset = lastUpdateId + 1;

  try {
    const url = `${TELEGRAM_API_BASE}${token}/getUpdates?offset=${offset}&timeout=5`;
    const response = await fetch(url);

    if (!response.ok) {
      const errText = await response.text();
      console.error('Telegram getUpdates error:', response.status, errText);
      await addSystemLog('telegram', `getUpdates failed: ${response.status} ${errText}`);
      return;
    }

    const data = await response.json();
    if (!data.ok || !data.result || !Array.isArray(data.result)) {
      return;
    }

    const updates = data.result as Array<{
      update_id: number;
      message?: { text?: string; chat: { id: number | string } };
      callback_query?: {
        id: string;
        data?: string;
        message?: {
          message_id: number;
          text?: string;
          chat: { id: number | string };
        };
      };
    }>;

    let maxUpdateId = lastUpdateId;
    let currentSettings = settings;

    for (const update of updates) {
      maxUpdateId = Math.max(maxUpdateId, update.update_id);

      let text: string | null = null;
      let sourceChatId: string | number | null = null;

      if (update.message?.text) {
        text = update.message.text;
        sourceChatId = update.message.chat.id;
      } else if (update.callback_query?.data) {
        text = update.callback_query.data;
        sourceChatId = update.callback_query.message?.chat?.id ?? null;
      }

      if (!text || sourceChatId === null) continue;

      const sourceChatIdStr = String(sourceChatId);
      if (sourceChatIdStr !== String(chatId)) {
        continue;
      }

      const parsed = parseTelegramInput(text);
      if (!parsed) continue;

      const outcome = await executeTelegramInput(currentSettings, parsed);
      currentSettings = await getSettings();

      const outcomePrefix = outcome.success ? '✅' : '❌';
      const firstLine = outcome.messages[0] ?? outcome.summary;
      const chatLine = firstLine.startsWith('✅') || firstLine.startsWith('❌')
        ? escapeMarkdownLinesPreservingEmojis(firstLine)
        : `${outcomePrefix} ${escapeMarkdown(outcome.summary)}`;

      const cq = update.callback_query;
      const isCallback = Boolean(cq?.id);
      const cbMessage = cq?.message;

      if (isCallback && cq?.id) {
        try {
          const toastText = truncateCallbackAnswer(
            `${outcomePrefix} ${outcome.summary}`
          );
          await fetch(`${TELEGRAM_API_BASE}${token}/answerCallbackQuery`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              callback_query_id: cq.id,
              text: toastText,
              show_alert: !outcome.success,
            }),
          });
        } catch (e) {
          console.warn('Failed to answerCallbackQuery:', e);
        }
      }

      const appendSuffix =
        outcome.messages.length === 1
          ? `\n\n*List update:*\n${chatLine}`
          : `\n\n*Done:*\n${outcomePrefix} ${escapeMarkdown(outcome.summary)}`;

      const multiReply = outcome.messages.length > 1;

      if (
        isCallback &&
        cbMessage &&
        typeof cbMessage.message_id === 'number' &&
        typeof cbMessage.text === 'string' &&
        !multiReply
      ) {
        let newText = cbMessage.text + appendSuffix;
        if (newText.length > 4096) {
          const budget = 4096 - appendSuffix.length - 30;
          newText = cbMessage.text.slice(0, Math.max(0, budget)) + '\n…' + appendSuffix;
        }
        const edited = await editTelegramMessageText(
          currentSettings.telegramBotToken,
          String(cbMessage.chat.id),
          cbMessage.message_id,
          newText,
          'Markdown'
        );
        if (!edited) {
          for (const msg of outcome.messages) {
            await sendTelegramMessage(
              currentSettings.telegramBotToken,
              currentSettings.telegramChatId,
              msg,
              'Markdown'
            );
          }
        }
      } else {
        for (const msg of outcome.messages) {
          await sendTelegramMessage(
            currentSettings.telegramBotToken,
            currentSettings.telegramChatId,
            msg,
            'Markdown'
          );
        }
        if (
          isCallback &&
          multiReply &&
          cbMessage &&
          typeof cbMessage.message_id === 'number' &&
          typeof cbMessage.text === 'string'
        ) {
          const note = `\n\n${outcomePrefix} ${escapeMarkdown(outcome.summary)}`;
          let newText = cbMessage.text + note;
          if (newText.length > 4096) {
            const budget = 4096 - note.length - 30;
            newText = cbMessage.text.slice(0, Math.max(0, budget)) + '\n…' + note;
          }
          await editTelegramMessageText(
            currentSettings.telegramBotToken,
            String(cbMessage.chat.id),
            cbMessage.message_id,
            newText,
            'Markdown'
          );
        }
      }
    }

    if (maxUpdateId > lastUpdateId) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.LAST_TELEGRAM_UPDATE_ID]: maxUpdateId,
      });
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Telegram poll error:', msg);
    await addSystemLog('telegram', `Poll error: ${msg}`);
  }
}

/** Escape user-controlled segments but keep leading Telegram outcome emoji lines readable */
function escapeMarkdownLinesPreservingEmojis(line: string): string {
  if (line.startsWith('✅') || line.startsWith('❌')) {
    const rest = line.slice(1).trimStart();
    return line[0] + ' ' + escapeMarkdown(rest);
  }
  return escapeMarkdown(line);
}
