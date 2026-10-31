/**
 * Pure settings migration and normalisation (no storage access).
 * storage.ts reads/writes; this module decides what the stored shape should be.
 */

import type { Settings } from '../types/index.ts';
import { DEFAULT_SETTINGS } from './default-settings.ts';
import { normalizeClassificationItems } from './classification-limits.ts';

const AUDIENCE_MAX_CHARS = 200;

export function deriveAudience(prompt: string | undefined | null): string {
  const p = (prompt ?? '').trim();
  if (p.startsWith('Evaluate if this site is suitable for children aged 6-10')) return 'children aged 6-10';
  if (p.startsWith('Classify content by educational value for teens aged 13-16')) return 'teenagers aged 13-16';
  if (p.startsWith('Determine if this content is exclusively educational and safe for children')) return 'children; be strict: anything not clearly suitable counts as unsuitable';
  return 'children';
}

/** Integer local hour 0..23, else the default for that field. */
function normalizeHour(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23 ? value : fallback;
}

/**
 * Quiet-hours config: only `{ enabled, allowedHours: { start, end } }` survives, so legacy keys
 * (e.g. the removed `dailyLimitMinutes`) are dropped and invalid hours fall back per field.
 */
function normalizeTimeLimits(raw: unknown): Settings['timeLimits'] {
  const defaults = DEFAULT_SETTINGS.timeLimits;
  const tl = (typeof raw === 'object' && raw !== null ? raw : {}) as {
    enabled?: unknown;
    allowedHours?: { start?: unknown; end?: unknown } | null;
  };
  return {
    enabled: typeof tl.enabled === 'boolean' ? tl.enabled : defaults.enabled,
    allowedHours: {
      start: normalizeHour(tl.allowedHours?.start, defaults.allowedHours.start),
      end: normalizeHour(tl.allowedHours?.end, defaults.allowedHours.end),
    },
  };
}

/**
 * Shallow merge can leave null / wrong types from hand-edited or legacy storage.
 * Ensures list and timeLimits shapes match what the options UI expects.
 */
export function normalizeSettingsShape(merged: Settings): Settings {
  const out: Settings = { ...merged };

  if (!Array.isArray(out.restrictedPatterns)) {
    out.restrictedPatterns = [...DEFAULT_SETTINGS.restrictedPatterns];
  }
  if (!Array.isArray(out.allowedPatterns)) {
    out.allowedPatterns = [...DEFAULT_SETTINGS.allowedPatterns];
  }
  if (!Array.isArray(out.ignoredPatterns)) {
    out.ignoredPatterns = [...DEFAULT_SETTINGS.ignoredPatterns];
  }
  if (!Array.isArray(out.categoryItems)) {
    out.categoryItems = [...DEFAULT_SETTINGS.categoryItems];
  }
  if (!Array.isArray(out.safetyLevelItems)) {
    out.safetyLevelItems = [...DEFAULT_SETTINGS.safetyLevelItems];
  }
  if (!Array.isArray(out.notificationTypes)) {
    out.notificationTypes = [...DEFAULT_SETTINGS.notificationTypes];
  }
  if (!Array.isArray(out.pageNotificationTypes)) {
    out.pageNotificationTypes = [...DEFAULT_SETTINGS.pageNotificationTypes];
  }

  out.timeLimits = normalizeTimeLimits(out.timeLimits);

  out.categoryItems = normalizeClassificationItems(out.categoryItems);
  out.safetyLevelItems = normalizeClassificationItems(out.safetyLevelItems);
  if (typeof out.decisionEnabled !== 'boolean') out.decisionEnabled = DEFAULT_SETTINGS.decisionEnabled;
  if (typeof out.enableAIExplanation !== 'boolean') out.enableAIExplanation = DEFAULT_SETTINGS.enableAIExplanation;
  if (typeof out.decisionApiToken !== 'string') out.decisionApiToken = '';
  if (typeof out.decisionModel !== 'string') out.decisionModel = '';
  const audience = typeof out.aiAudience === 'string' ? out.aiAudience.trim().slice(0, AUDIENCE_MAX_CHARS) : '';
  out.aiAudience = audience || DEFAULT_SETTINGS.aiAudience;
  if (typeof out.aiExplanationPrompt !== 'string' || !out.aiExplanationPrompt.trim()) out.aiExplanationPrompt = DEFAULT_SETTINGS.aiExplanationPrompt;

  return out;
}

/** Migrate legacy available/restricted arrays to categoryItems/safetyLevelItems */
function migrateToItems(
  available: string[],
  restricted: string[]
): Array<{ name: string; restricted: boolean }> {
  const seen = new Set<string>();
  const items: Array<{ name: string; restricted: boolean }> = [];
  for (const name of [...available, ...restricted]) {
    const n = name.trim();
    if (n && !seen.has(n.toLowerCase())) {
      seen.add(n.toLowerCase());
      items.push({ name: n, restricted: restricted.some((r) => r.trim().toLowerCase() === n.toLowerCase()) });
    }
  }
  return items;
}

/**
 * Derive available/restricted from items for backward compat with ai-classifier, url-matcher
 */
function deriveFromItems(items: Array<{ name: string; restricted: boolean }>): {
  available: string[];
  restricted: string[];
} {
  return {
    available: items.map((i) => i.name),
    restricted: items.filter((i) => i.restricted).map((i) => i.name),
  };
}

/**
 * Stored settings -> settings as they should be persisted:
 * defaults merged in, legacy available/restricted lists turned into items, shapes normalised.
 */
export function migrateStoredSettings(stored: Settings): Settings {
  const derivedAudience = typeof stored.aiAudience === 'string' ? undefined : deriveAudience(stored.aiClassificationPrompt);
  let merged: Settings = { ...DEFAULT_SETTINGS, ...stored };
  if (derivedAudience !== undefined) merged.aiAudience = derivedAudience;

  // Migration: legacy availableCategories/restrictedCategories -> categoryItems
  if (!merged.categoryItems?.length && (merged.availableCategories?.length || merged.restrictedCategories?.length)) {
    merged = {
      ...merged,
      categoryItems: migrateToItems(merged.availableCategories || [], merged.restrictedCategories || []),
    };
  }
  if (!merged.safetyLevelItems?.length && (merged.availableSafetyLevels?.length || merged.restrictedSafetyLevels?.length)) {
    merged = {
      ...merged,
      safetyLevelItems: migrateToItems(merged.availableSafetyLevels || [], merged.restrictedSafetyLevels || []),
    };
  }

  return normalizeSettingsShape(merged);
}

/**
 * Settings as consumers see them: available/restricted category and safety-level
 * lists derived from the items (for ai-classifier, url-matcher).
 */
export function withDerivedClassificationLists(settings: Settings): Settings {
  const out: Settings = { ...settings };
  if (out.categoryItems?.length) {
    const { available, restricted } = deriveFromItems(out.categoryItems);
    out.availableCategories = available;
    out.restrictedCategories = restricted;
  }
  if (out.safetyLevelItems?.length) {
    const { available, restricted } = deriveFromItems(out.safetyLevelItems);
    out.availableSafetyLevels = available;
    out.restrictedSafetyLevels = restricted;
  }
  return out;
}
