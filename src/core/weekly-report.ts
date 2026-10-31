/**
 * Weekly report: stats from stored history and the "is a report due" state machine (pure).
 * No chrome.*, no Date.now(): callers pass the instant.
 */

import type { HistoryEntry } from '../types/index.ts';
import { formatLocalDate } from './local-time.ts';
import { isTelegramTypeEligible, type TelegramEligibilitySettings } from './telegram-eligibility.ts';

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Minimum gap between two send attempts (also the retry back-off after a failure). */
export const WEEKLY_RETRY_MS = 60 * 60 * 1000;

export interface WeeklyStats {
  totalVisits: number;
  educationalVisits: number;
  educationalPercentage: number;
  restrictedAttempts: number;
  topCategories: string[];
  periodStart: string;
  periodEnd: string;
}

/** Placeholder categories that say nothing about the content. */
function isPlaceholderCategory(category: string): boolean {
  const lower = category.toLowerCase();
  return lower === '' || lower === 'not specified' || lower === 'unknown';
}

/** Visits of one entry inside [from, to): its visit times, or its timestamp when it has none. */
function countVisitsInWindow(entry: HistoryEntry, from: number, to: number): number {
  const visits = entry.visits;
  if (Array.isArray(visits) && visits.length > 0) {
    let count = 0;
    for (const visit of visits) {
      if (visit.visitTime >= from && visit.visitTime < to) count++;
    }
    return count;
  }
  return entry.timestamp >= from && entry.timestamp < to ? 1 : 0;
}

export function buildWeeklyStats(history: readonly HistoryEntry[], now: number): WeeklyStats {
  const from = now - WEEK_MS;
  let totalVisits = 0;
  let restrictedAttempts = 0;
  let educationalVisits = 0;
  const categoryCounts = new Map<string, number>();

  for (const entry of history) {
    const visits = countVisitsInWindow(entry, from, now);
    if (visits === 0) continue;
    totalVisits += visits;

    if (entry.restricted === true) {
      restrictedAttempts += visits;
    } else if ((entry.classification?.isEducational ?? entry.classification?.educational) === true) {
      educationalVisits += visits;
    }

    const category = typeof entry.classification?.category === 'string' ? entry.classification.category.trim() : '';
    if (!isPlaceholderCategory(category)) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + visits);
    }
  }

  // Count desc, then name asc (plain comparison: locale-independent).
  const topCategories = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, 3)
    .map(([name]) => name);

  return {
    totalVisits,
    educationalVisits,
    educationalPercentage: totalVisits === 0 ? 0 : Math.round((educationalVisits / totalVisits) * 100),
    restrictedAttempts,
    topCategories,
    periodStart: formatLocalDate(from),
    periodEnd: formatLocalDate(now),
  };
}

export interface WeeklyReportState {
  lastReportAt?: number;
  anchorAt?: number;
  lastAttemptAt?: number;
}

export type WeeklyReportAction = 'send' | 'wait' | 'none' | 'set-anchor' | 'clear-anchor';

export function weeklyReportAction(state: WeeklyReportState, eligible: boolean, now: number): WeeklyReportAction {
  if (!eligible) return state.lastReportAt === undefined ? 'clear-anchor' : 'none';

  const base = state.lastReportAt ?? state.anchorAt;
  if (base === undefined) return 'set-anchor';

  if (now < base + WEEK_MS) return 'wait';

  // A future attempt stamp (clock moved back) is ignored so it cannot block reports for days.
  const { lastAttemptAt } = state;
  if (lastAttemptAt !== undefined && lastAttemptAt <= now && now - lastAttemptAt < WEEKLY_RETRY_MS) return 'wait';

  return 'send';
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Storage values -> state; anything that is not a finite number counts as missing. */
export function readWeeklyState(raw: Record<string, unknown>): WeeklyReportState {
  const state: WeeklyReportState = {};
  const lastReportAt = finiteNumber(raw.lastWeeklyReportAt);
  const anchorAt = finiteNumber(raw.weeklyReportAnchorAt);
  const lastAttemptAt = finiteNumber(raw.weeklyReportLastAttemptAt);
  if (lastReportAt !== undefined) state.lastReportAt = lastReportAt;
  if (anchorAt !== undefined) state.anchorAt = anchorAt;
  if (lastAttemptAt !== undefined) state.lastAttemptAt = lastAttemptAt;
  return state;
}

export function isWeeklyEligible(settings: TelegramEligibilitySettings): boolean {
  return isTelegramTypeEligible(settings, 'weekly');
}
