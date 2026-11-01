import type { ClassificationResult, GenerativeState, Settings, TelegramNoticeRef } from '../types/index.ts';
import { EXPLANATION_STALE_PENDING_MS } from './explanation.ts';
import { capText, escapeMarkdown, sanitizeModelText } from './telegram-markdown.ts';

export const TELEGRAM_MAX_TEXT_CHARS = 4096;
export const PENDING_PARAGRAPH = '⏳ _Preparing explanation…_';
const CAPS = { user: 60, title: 150, url: 400, pattern: 100, category: 60, safety: 60, reason: 400, noUrl: 150, suggested: 400 };

export interface BlockedSiteMessageInput {
  userProfile: string;
  title: string;
  url: string;
  reasonCode: string;
  matchedPattern?: string | null;
  classification: ClassificationResult | null;
  pending: boolean;
  sentAt: number;
}

export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const field = (raw: string, cap: number): string => escapeMarkdown(capText(sanitizeModelText(raw), cap));

export function formatAccessOutcomeMarkdown(outcome: 'allowed' | 'blocked', reasonCode: string, matchedPattern?: string | null): string {
  const esc = (s: string) => escapeMarkdown(s);
  if (outcome === 'allowed') {
    if (reasonCode === 'allowed') return `*Access:* ✅ Allowed — ${esc('URL matches an entry on the allow list')}`;
    if (reasonCode === 'permitted') return `*Access:* ✅ Allowed — ${esc('No URL restriction matched; page permitted')}`;
    return `*Access:* ✅ Allowed — ${esc(reasonCode)}`;
  }
  if (reasonCode === 'restricted') {
    const p = matchedPattern?.trim();
    const detail = p ? `URL matches restricted list (pattern: ${p})` : 'URL matches restricted list';
    return `*Access:* 🚫 Blocked — ${esc(detail)}`;
  }
  if (reasonCode === 'content-restricted') return `*Access:* 🚫 Blocked — ${esc('Content restriction (category or risk level)')}`;
  return `*Access:* 🚫 Blocked — ${esc(reasonCode)}`;
}

interface Opts { pattern: boolean; noUrl: boolean; details: boolean; reasonCap: number }

export function buildBlockedSiteMessage(input: BlockedSiteMessageInput, maxChars: number = TELEGRAM_MAX_TEXT_CHARS): string {
  const levels: Opts[] = [
    { pattern: true, noUrl: true, details: true, reasonCap: CAPS.reason },
    { pattern: false, noUrl: true, details: true, reasonCap: CAPS.reason },
    { pattern: false, noUrl: false, details: true, reasonCap: CAPS.reason },
    { pattern: false, noUrl: false, details: false, reasonCap: CAPS.reason },
  ];
  for (const o of levels) {
    const t = render(input, o);
    if (t.length <= maxChars) return t;
  }
  // cut the reason: largest cap that fits
  const last = levels[levels.length - 1];
  let lo = 0;
  let hi = CAPS.reason;
  let best = render(input, { ...last, reasonCap: 0 });
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = render(input, { ...last, reasonCap: mid });
    if (t.length <= maxChars) { best = t; lo = mid + 1; } else { hi = mid - 1; }
  }
  return best;
}

function render(input: BlockedSiteMessageInput, o: Opts): string {
  const cls = input.classification && !input.classification.error ? input.classification : null;
  const userProfile = field(input.userProfile || 'Unknown User', CAPS.user);
  const displayUrl = field(input.url, CAPS.url);
  const reasonCode = input.reasonCode;
  const displayReason = escapeMarkdown(reasonCode === 'restricted' ? 'Site in restricted list' : reasonCode);
  const patternRaw = input.matchedPattern ? capText(sanitizeModelText(input.matchedPattern), CAPS.pattern) : '';
  const displayPattern = patternRaw ? escapeMarkdown(patternRaw) : null;
  const pageTitle = input.title ?? '';
  const title = field(pageTitle, CAPS.title);
  const titleLines = `📄 *Title:* ${title === '' ? '_Not specified_' : title}\n🔗 *URL:* ${displayUrl}\n`;
  const access = formatAccessOutcomeMarkdown('blocked', reasonCode, patternRaw || null);
  const stamp = formatTimestamp(input.sentAt);
  const patternLine = o.pattern && displayPattern ? `🔍 *Pattern:* ${displayPattern}\n` : '';
  if (!cls) {
    const loc = pageTitle.trim() ? titleLines : `🔗 *URL:* ${displayUrl}\n`;
    return `🚫 *Site Access Restricted* — *${userProfile}*\n\n${access}\n\n` + loc + `📝 *Reason:* ${displayReason}\n` + patternLine + `\n🕐 ${stamp}`;
  }
  const isEducational = cls.isEducational ?? cls.educational ?? null;
  const detection = isEducational === false ? '*Detection:* Non-educational content\n' : isEducational === true ? '*Detection:* Educational content\n' : '';
  const reasonRaw = capText(sanitizeModelText(cls.reason || 'Not specified'), o.reasonCap);
  const reason = escapeMarkdown(reasonRaw);
  let block = '';
  if (o.details) {
    const age = cls.isAgeAppropriate ?? cls.ageAppropriate ?? null;
    const ageStatus = age !== null && age !== undefined ? (age ? 'Yes' : 'No') : 'Not specified';
    const edu = isEducational !== null && isEducational !== undefined ? (isEducational ? 'Yes' : 'No') : 'Unknown';
    block =
      `📊 *Classification Details:*\n` +
      `   • Category: ${field(cls.category || 'Unknown', CAPS.category)}\n` +
      `   • Risk Level: ${field(cls.safetyLevel || 'Not specified', CAPS.safety)}\n` +
      `   • Age Appropriate: ${ageStatus}\n\n` +
      `   • Educational: ${edu}\n`;
    if (!input.pending) {
      const suggested = cls.suggestedUrl ?? cls.suggestedEducationalResource ?? null;
      if (suggested) {
        block += `   • Suggested Educational Resource: ${field(suggested, CAPS.suggested)}\n`;
      } else {
        block += `   • Suggested Educational Resource: Not specified`;
        if (cls.noUrlReason && o.noUrl) block += ` (${field(cls.noUrlReason, CAPS.noUrl)})`;
        block += `\n`;
      }
    }
    block += '\n';
  }
  block += `📝 *Reason:*\n${reason}\n`;
  if (input.pending) block += `\n${PENDING_PARAGRAPH}\n`;
  const restriction = `📝 *Restriction:* ${displayReason}\n`;
  return `🚫 *Site Access Restricted* — *${userProfile}*\n\n` + detection + `${access}\n\n` + titleLines + restriction + patternLine + `\n${block}` + `\n🕐 ${stamp}`;
}

export function toBlockedSiteMessageInput(
  settings: Pick<Settings, 'userProfileName'>,
  p: { url: string; reason: string; matchedPattern?: string | null; pageTitle?: string; classification?: ClassificationResult | null; pending: boolean; sentAt: number },
): BlockedSiteMessageInput {
  return {
    userProfile: settings.userProfileName,
    title: p.pageTitle ?? '',
    url: p.url,
    reasonCode: p.reason,
    matchedPattern: p.matchedPattern ?? null,
    classification: p.classification ?? null,
    pending: p.pending,
    sentAt: p.sentAt,
  };
}

export function selectNoticeVariant(x: { eligible: boolean; planned: boolean }): 'none' | 'pending' | 'plain' {
  if (!x.eligible) return 'none';
  return x.planned ? 'pending' : 'plain';
}

export function urlToCallbackData(url: string): string {
  try {
    const urlStr = url.includes('://') ? url : `https://${url}`;
    const hostname = new URL(urlStr).hostname?.replace(/^www\./i, '') || url;
    return hostname.length > 50 ? hostname.substring(0, 50) : hostname;
  } catch {
    return url.length > 50 ? url.substring(0, 50) : url;
  }
}

export type InlineKeyboard = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

export function buildInlineKeyboardForUrl(url: string): InlineKeyboard {
  const data = urlToCallbackData(url);
  return {
    inline_keyboard: [
      [
        { text: '➕ Add to Allowed', callback_data: `allow:${data}` },
        { text: '➕ Add to Restricted', callback_data: `restrict:${data}` },
      ],
      [{ text: '➕ Add to Ignored', callback_data: `ignore:${data}` }],
    ],
  };
}

export function buildEditMessageBody(chatId: string | number, messageId: number, text: string, parseMode: string, replyMarkup?: InlineKeyboard) {
  return {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: parseMode,
    reply_markup: JSON.stringify(replyMarkup ?? { inline_keyboard: [] }),
  };
}

export function parseSendResult(bodyText: string): { messageId: number | null } {
  try {
    const id = JSON.parse(bodyText)?.result?.message_id;
    return { messageId: typeof id === 'number' && Number.isInteger(id) ? id : null };
  } catch {
    return { messageId: null };
  }
}

export function isMessageNotModified(description: string | null | undefined): boolean {
  return !!description && /message is not modified/i.test(description);
}

export function buildTelegramNoticeRef(p: { chatId: string; messageId: number; enableTelegramCommands: boolean; url: string; text: string; fallbackText: string }): TelegramNoticeRef {
  return { chatId: p.chatId, messageId: p.messageId, keyboardUrl: p.enableTelegramCommands ? p.url : null, finalized: false, text: p.text, fallbackText: p.fallbackText };
}

export function planNoticeRecovery(g: GenerativeState | undefined, now: number):
  { action: 'none' } | { action: 'edit'; ref: TelegramNoticeRef; text: string; keyboardUrl: string | null; markFailed: boolean } {
  const ref = g?.telegram;
  if (!g || !ref || ref.finalized) return { action: 'none' };
  if (g.status === 'pending') {
    if (now - g.attemptedAt < EXPLANATION_STALE_PENDING_MS) return { action: 'none' };
    return { action: 'edit', ref, text: ref.fallbackText ?? ref.text ?? '', keyboardUrl: ref.keyboardUrl, markFailed: true };
  }
  return { action: 'edit', ref, text: ref.text ?? ref.fallbackText ?? '', keyboardUrl: ref.keyboardUrl, markFailed: false };
}
