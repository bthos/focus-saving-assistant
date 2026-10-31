/**
 * Stage 2 orchestration for a page the decision model blocked: single-flight run of the generative model,
 * then one settle step (cache, history, block page, Telegram edit), and recovery of notices a stopped
 * service worker left half-finished.
 *
 * Telegram: exactly one message is sent per block event (by blockNavigation, in its `pending` layout);
 * this module only EDITS that message (at most two edit calls) and never sends.
 */

import type { ClassificationResult, Settings, TelegramNoticeRef } from '../types';
import { explainBlock, type ExplanationRunOutcome } from '../utils/ai-classifier';
import {
  clearLastAiError,
  getClassificationCache,
  getSettings,
  setLastAiError,
  updateCachedClassification,
  updateHistoryClassification,
  updateLastRestrictedUrl,
} from '../utils/storage';
import { addSystemLog } from '../utils/system-logger';
import { editTelegramMessageText } from '../utils/telegram-notifier';
import { prefixStageError } from '../core/ai-errors.ts';
import {
  applyExplanation,
  EXPLANATION_TIMEOUT_MS,
  withNoticeFinalized,
  withoutTelegramNotice,
  withTelegramNotice,
  type ExplanationInput,
} from '../core/explanation.ts';
import { applyExplanationToRestrictedInfo } from '../core/restricted-info.ts';
import {
  buildBlockedSiteMessage,
  buildInlineKeyboardForUrl,
  buildTelegramNoticeRef,
  planNoticeRecovery,
  toBlockedSiteMessageInput,
} from '../core/telegram-block-message.ts';

/** Chrome stops an idle worker after 30 s; an extension API call every 15 s keeps it alive while Stage 2 waits. */
const KEEP_ALIVE_PING_MS = 15000;

/** What the Telegram message of a block event was built from; edits reuse it so only the content differs. */
export interface BlockNotice {
  /** Timestamp printed in the first message; every edit reuses it. */
  sentAt: number;
  pageTitle: string;
  reasonCode: string;
  matchedPattern: string | null;
}

const inFlight = new Map<string, Promise<ExplanationRunOutcome>>();

function hostKey(url: string | undefined): string {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return url ?? '';
  }
}

/**
 * Runs Stage 2 for a claimed cache entry. Never rejects. One run per host at a time inside this worker:
 * a second caller for the same host gets the same promise. The request is aborted after EXPLANATION_TIMEOUT_MS.
 */
export function startExplanation(settings: Settings, claimed: ClassificationResult): Promise<ExplanationRunOutcome> {
  const key = hostKey(claimed.url);
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXPLANATION_TIMEOUT_MS);
  const run = explainBlock(settings, claimed, { signal: controller.signal })
    .catch((error): ExplanationRunOutcome => ({
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }))
    .finally(() => {
      clearTimeout(timer);
      inFlight.delete(key);
    });
  inFlight.set(key, run);
  return run;
}

/** Awaits a Stage 2 run while keeping the service worker alive. */
export async function waitForExplanation(explanation: Promise<ExplanationRunOutcome>): Promise<ExplanationRunOutcome> {
  const ping = setInterval(() => {
    void chrome.runtime.getPlatformInfo().catch(() => undefined);
  }, KEEP_ALIVE_PING_MS);
  try {
    return await explanation;
  } finally {
    clearInterval(ping);
  }
}

function buildNoticeText(settings: Settings, url: string, classification: ClassificationResult, notice: BlockNotice): string {
  return buildBlockedSiteMessage(toBlockedSiteMessageInput(settings, {
    url,
    reason: notice.reasonCode,
    matchedPattern: notice.matchedPattern,
    pageTitle: notice.pageTitle,
    classification,
    pending: false,
    sentAt: notice.sentAt,
  }));
}

/**
 * Persists the reference to the just-sent `pending` notice into the cache entry, together with the
 * `fallback` layout built up front (what the message becomes if Stage 2 fails or the worker dies).
 */
export async function recordNoticeRef(a: {
  url: string;
  settings: Settings;
  claimed: ClassificationResult;
  sent: { chatId: string; messageId: number };
  notice: BlockNotice;
}): Promise<TelegramNoticeRef> {
  const failedView = applyExplanation(a.claimed, { status: 'failed', error: '' }, { now: Date.now() });
  const fallbackText = buildNoticeText(a.settings, a.url, failedView, a.notice);
  const ref = buildTelegramNoticeRef({
    chatId: a.sent.chatId,
    messageId: a.sent.messageId,
    enableTelegramCommands: a.settings.enableTelegramCommands,
    url: a.url,
    text: fallbackText,
    fallbackText,
  });
  await updateCachedClassification(a.url, a.claimed.classifiedAt, (entry) => withTelegramNotice(entry, ref));
  return ref;
}

/**
 * Edits the notice once, plus one retry with the code-built fallback text if the first edit failed
 * (a Markdown error caused by model text cannot repeat there). Never sends a new message.
 */
async function editNotice(ref: TelegramNoticeRef, text: string, fallbackText: string | undefined): Promise<void> {
  const current = await getSettings();
  if (!current.telegramBotToken || String(ref.chatId) !== String(current.telegramChatId)) {
    await addSystemLog('telegram', 'Notice edit skipped: Telegram token missing or chat changed since the message was sent');
    return;
  }
  const keyboard = ref.keyboardUrl ? buildInlineKeyboardForUrl(ref.keyboardUrl) : undefined;
  if (await editTelegramMessageText(current.telegramBotToken, ref.chatId, ref.messageId, text, 'Markdown', keyboard)) {
    return;
  }
  if (fallbackText && fallbackText !== text) {
    const retried = await editTelegramMessageText(current.telegramBotToken, ref.chatId, ref.messageId, fallbackText, 'Markdown', keyboard);
    if (!retried) {
      await addSystemLog('telegram', 'Notice edit failed twice; the message keeps its previous text');
    }
  } else {
    await addSystemLog('telegram', 'Notice edit failed; the message keeps its previous text');
  }
}

/** One settle step must not stop the later ones (the Telegram edit still has to happen). */
async function step(label: string, task: () => Promise<unknown>): Promise<void> {
  try {
    await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Explanation step failed (${label}):`, message);
    await addSystemLog('system', `Explanation step failed (${label}): ${message}`);
  }
}

/**
 * Settles a block event after Stage 2: result into cache, history and the block page, the options banner,
 * then the single Telegram edit, then the notice is finalized (also after a failed edit, so recovery does not loop).
 */
export async function finishExplanation(a: {
  url: string;
  settings: Settings;
  claimed: ClassificationResult;
  outcome: ExplanationRunOutcome;
  notice: BlockNotice;
  ref: TelegramNoticeRef | null;
}): Promise<void> {
  const { url, settings, claimed, outcome, notice, ref } = a;
  const now = Date.now();
  const input: ExplanationInput = outcome.status === 'done'
    ? { status: 'done', reply: outcome.reply, model: outcome.model, restrictedPatterns: settings.restrictedPatterns }
    : { status: 'failed', error: outcome.error };

  // What the page was settled to: model reason + validated link, or the synthesized reason after a failure.
  const applied = applyExplanation(claimed, input, { now });
  const noticeText = ref ? buildNoticeText(settings, url, applied, notice) : undefined;

  let settled = applied;
  await step('cache', async () => {
    const stored = await updateCachedClassification(url, claimed.classifiedAt, (entry) =>
      applyExplanation(entry, input, { now, noticeText }));
    if (stored) {
      settled = stored;
    }
  });
  const forPages = withoutTelegramNotice(settled);

  await step('history', () => updateHistoryClassification(url, forPages));
  await step('block page', () => updateLastRestrictedUrl(url, (info) =>
    applyExplanationToRestrictedInfo(
      info,
      outcome.status === 'done' ? { url, status: 'done', classification: forPages } : { url, status: 'failed' }
    )));
  await step('error banner', () => outcome.status === 'done'
    ? clearLastAiError('explanation')
    : setLastAiError(prefixStageError('explanation', outcome.error)));

  if (ref && noticeText !== undefined) {
    await step('telegram edit', () => editNotice(ref, noticeText, ref.fallbackText));
    await step('finalize notice', () => updateCachedClassification(url, claimed.classifiedAt, withNoticeFinalized));
  }
}

let recoveryStarted = false;

/**
 * Once per service-worker start: finishes notices that a stopped worker (or another process) left in their
 * `pending` layout. A stale `pending` claim (older than EXPLANATION_STALE_PENDING_MS) is marked failed.
 * Edits are idempotent ("message is not modified" counts as success), so two workers cannot conflict.
 */
export async function recoverUnfinishedNotices(): Promise<void> {
  if (recoveryStarted) {
    return;
  }
  recoveryStarted = true;

  const cache = await getClassificationCache();
  const now = Date.now();
  for (const entry of Object.values(cache)) {
    const plan = planNoticeRecovery(entry.generative, now);
    if (plan.action !== 'edit' || !entry.url) {
      continue;
    }
    const url = entry.url;
    await step(`recover ${url}`, async () => {
      const settled = plan.markFailed
        ? applyExplanation(entry, { status: 'failed', error: 'worker stopped' }, { now })
        : entry;
      if (plan.markFailed) {
        await updateCachedClassification(url, entry.classifiedAt, (current) =>
          applyExplanation(current, { status: 'failed', error: 'worker stopped' }, { now }));
      }
      const forPages = withoutTelegramNotice(settled);
      const done = settled.generative?.status === 'done';
      await updateHistoryClassification(url, forPages);
      await updateLastRestrictedUrl(url, (info) =>
        applyExplanationToRestrictedInfo(info, done ? { url, status: 'done', classification: forPages } : { url, status: 'failed' }));
      await editNotice(plan.ref, plan.text, plan.ref.fallbackText);
      await updateCachedClassification(url, entry.classifiedAt, withNoticeFinalized);
    });
  }
}
