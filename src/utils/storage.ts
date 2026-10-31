/**
 * Utilities for working with chrome.storage
 */

import type { Settings, HistoryEntry, ClassificationResult, ClassificationCache } from '../types/index.js';
import { DEFAULT_SETTINGS } from '../core/default-settings.ts';
import { isClassificationUseful } from '../core/classification.ts';
import { tryClaimExplanation } from '../core/explanation.ts';
import { mergeHistoryEntries, patchHistoryClassification, upsertHistoryEntry, type NewHistoryEntry } from '../core/history-merge.ts';
import type { RestrictedInfo } from '../core/restricted-info.ts';
import { shouldClearAiError, type AiStage } from '../core/ai-errors.ts';
import { migrateStoredSettings, normalizeSettingsShape, withDerivedClassificationLists } from '../core/settings-migration.ts';
import { MAX_HISTORY_ENTRIES, STORAGE_KEYS, CLASSIFICATION_CACHE_TTL_MS } from './constants.js';

/**
 * Initialize default settings
 */
export async function initializeSettings(): Promise<void> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS]);
  const stored = result[STORAGE_KEYS.SETTINGS] as Settings | undefined;

  if (!stored) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
    return;
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: migrateStoredSettings(stored) });
}

/**
 * Get settings (with derived available/restricted for consumers)
 */
export async function getSettings(): Promise<Settings> {
  await initializeSettings();
  const result = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS]);
  const raw = (result[STORAGE_KEYS.SETTINGS] as Settings) || DEFAULT_SETTINGS;
  const settings: Settings = normalizeSettingsShape({ ...DEFAULT_SETTINGS, ...raw });

  // Derive available/restricted from items for ai-classifier, url-matcher
  return withDerivedClassificationLists(settings);
}

/**
 * Save settings
 */
export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

/**
 * Get browsing history
 */
export async function getHistory(): Promise<HistoryEntry[]> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.HISTORY]);
  return (result[STORAGE_KEYS.HISTORY] as HistoryEntry[]) || [];
}

/**
 * Add entry to history
 * Merges visits if URL already exists, otherwise adds new entry
 */
export async function addHistoryEntry(entry: NewHistoryEntry): Promise<HistoryEntry> {
  const history = await getHistory();
  const now = Date.now();
  const { history: updated, entry: result } = upsertHistoryEntry(history, entry, now, now + Math.random());

  // Limit history to last MAX_HISTORY_ENTRIES entries
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: updated.slice(0, MAX_HISTORY_ENTRIES) });
  return result;
}

/**
 * Clear history
 */
export async function clearHistory(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: [] });
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_HISTORY_SYNC_TIME]: 0 });
}

/**
 * Get last history sync time
 */
export async function getLastHistorySyncTime(): Promise<number> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.LAST_HISTORY_SYNC_TIME]);
  return (result[STORAGE_KEYS.LAST_HISTORY_SYNC_TIME] as number) || 0;
}

/**
 * Set last history sync time
 */
export async function setLastHistorySyncTime(timestamp: number): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_HISTORY_SYNC_TIME]: timestamp });
}

/**
 * Merge and save history entries
 */
export async function mergeAndSaveHistory(newEntries: HistoryEntry[]): Promise<void> {
  const existingHistory = await getHistory();
  const merged = mergeHistoryEntries(existingHistory, newEntries);
  
  // Limit to last MAX_HISTORY_ENTRIES entries
  const limitedHistory = merged.slice(0, MAX_HISTORY_ENTRIES);
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: limitedHistory });
}

/**
 * Get classification cache
 */
export async function getClassificationCache(): Promise<ClassificationCache> {
  const result = await chrome.storage.local.get([STORAGE_KEYS.CLASSIFICATION_CACHE]);
  return (result[STORAGE_KEYS.CLASSIFICATION_CACHE] as ClassificationCache) || {};
}

// Read-modify-write steps on the classification cache (and lastRestrictedUrl) run one at a time inside this
// worker, so a claim, a Telegram reference, a Stage 2 result and a fresh classification cannot overwrite each other.
let cacheWriteChain: Promise<unknown> = Promise.resolve();

export function withCacheWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = cacheWriteChain.then(fn);
  cacheWriteChain = run.catch(() => undefined);
  return run;
}

/**
 * Save classification result to cache
 * Only caches if classification contains useful information
 */
export async function cacheClassification(url: string, classification: ClassificationResult): Promise<void> {
  // Skip caching if classification doesn't contain useful information
  if (!isClassificationUseful(classification)) {
    return;
  }

  await withCacheWrite(async () => {
    const cache = await getClassificationCache();
    const domain = new URL(url).hostname;
    cache[domain] = {
      ...classification,
      cachedAt: Date.now()
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.CLASSIFICATION_CACHE]: cache });
  });
}

/**
 * Get classification from cache
 */
export async function getCachedClassification(url: string): Promise<ClassificationResult | null> {
  const cache = await getClassificationCache();
  const domain = new URL(url).hostname;
  const cached = cache[domain];
  
  if (cached && cached.cachedAt) {
    // Check cache validity
    const cacheAge = Date.now() - cached.cachedAt;
    if (cacheAge < CLASSIFICATION_CACHE_TTL_MS) {
      return cached;
    }
  }
  
  return null;
}

/**
 * Rewrites the cache entry of this URL's host when it is still the classification the caller started from
 * (same classifiedAt). `cachedAt` is always kept, so a rewrite can never extend the 24 h lifetime.
 * Must run inside withCacheWrite. Returns the stored entry, or null when nothing was written.
 */
async function rewriteCachedEntry(
  url: string,
  expectClassifiedAt: number | undefined,
  rewrite: (entry: ClassificationResult) => ClassificationResult | null
): Promise<ClassificationResult | null> {
  let domain: string;
  try {
    domain = new URL(url).hostname;
  } catch {
    return null;
  }
  const cache = await getClassificationCache();
  const entry = cache[domain];
  if (!entry || entry.classifiedAt !== expectClassifiedAt) {
    return null;
  }
  const rewritten = rewrite(entry);
  if (!rewritten) {
    return null;
  }
  const stored: ClassificationResult = { ...rewritten, cachedAt: entry.cachedAt };
  cache[domain] = stored;
  await chrome.storage.local.set({ [STORAGE_KEYS.CLASSIFICATION_CACHE]: cache });
  return stored;
}

/**
 * Marks the Stage 2 attempt of a cache entry as pending. Resolves the claimed entry, or null when the entry
 * is gone, was replaced, or already has a generative state (at most one attempt per cache entry).
 */
export function claimExplanation(
  url: string,
  expectClassifiedAt: number | undefined,
  now: number
): Promise<ClassificationResult | null> {
  return withCacheWrite(() => rewriteCachedEntry(url, expectClassifiedAt, (entry) => tryClaimExplanation(entry, now)));
}

/**
 * Applies `updater` to the cache entry of this URL's host if it is still the same classification.
 * Keeps cachedAt. Resolves the stored entry, or null when nothing was written.
 */
export function updateCachedClassification(
  url: string,
  expectClassifiedAt: number | undefined,
  updater: (entry: ClassificationResult) => ClassificationResult
): Promise<ClassificationResult | null> {
  return withCacheWrite(() => rewriteCachedEntry(url, expectClassifiedAt, updater));
}

/**
 * Replaces only the classification of the history entry with this exact URL (no-op when absent).
 */
export async function updateHistoryClassification(url: string, classification: ClassificationResult): Promise<void> {
  const history = await getHistory();
  const patched = patchHistoryClassification(history, url, classification);
  if (patched === history) {
    return;
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.HISTORY]: patched });
}

/**
 * Read-modify-write of lastRestrictedUrl, only while it still describes this URL.
 */
export function updateLastRestrictedUrl(url: string, updater: (info: RestrictedInfo) => RestrictedInfo): Promise<void> {
  return withCacheWrite(async () => {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.LAST_RESTRICTED_URL]);
    const current = stored[STORAGE_KEYS.LAST_RESTRICTED_URL] as RestrictedInfo | undefined;
    if (!current || current.url !== url) {
      return;
    }
    const next = updater(current);
    if (next !== current) {
      await chrome.storage.local.set({ [STORAGE_KEYS.LAST_RESTRICTED_URL]: next });
    }
  });
}

/**
 * Banner text shown on the options page.
 */
export async function setLastAiError(message: string): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_AI_ERROR]: message });
}

/**
 * Clears the banner after a success. With a stage it clears only that stage's own text (a Stage 1 success
 * must not erase a Stage 2 failure); without one (single-call mode) it always clears.
 */
export async function clearLastAiError(stage?: AiStage): Promise<void> {
  if (stage) {
    const stored = await chrome.storage.local.get([STORAGE_KEYS.LAST_AI_ERROR]);
    if (!shouldClearAiError(stored[STORAGE_KEYS.LAST_AI_ERROR] as string | undefined, stage)) {
      return;
    }
  }
  await chrome.storage.local.remove(STORAGE_KEYS.LAST_AI_ERROR);
}
