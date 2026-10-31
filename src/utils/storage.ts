/**
 * Utilities for working with chrome.storage
 */

import type { Settings, HistoryEntry, ClassificationResult, ClassificationCache } from '../types/index.js';
import { DEFAULT_SETTINGS } from '../core/default-settings.ts';
import { isClassificationUseful } from '../core/classification.ts';
import { mergeHistoryEntries, upsertHistoryEntry, type NewHistoryEntry } from '../core/history-merge.ts';
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

/**
 * Save classification result to cache
 * Only caches if classification contains useful information
 */
export async function cacheClassification(url: string, classification: ClassificationResult): Promise<void> {
  // Skip caching if classification doesn't contain useful information
  if (!isClassificationUseful(classification)) {
    return;
  }
  
  const cache = await getClassificationCache();
  const domain = new URL(url).hostname;
  cache[domain] = {
    ...classification,
    cachedAt: Date.now()
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.CLASSIFICATION_CACHE]: cache });
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
