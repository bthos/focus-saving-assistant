/**
 * Quiet hours: pure window maths (no chrome.*, no Date.now()).
 * Every function takes the instant, so callers and tests inject it.
 *
 * `allowedHours.start/end` are integer local hours 0..23. The *allowed* window is
 * [start, end); quiet hours are the complement.
 *   start === end  -> no quiet hours (always allowed)
 *   start <  end   -> allowed iff start <= m < end
 *   start >  end   -> allowed overnight: m >= start || m < end
 * `m` = local minutes since midnight from getHours()/getMinutes() (never UTC or +24 h),
 * so DST days follow the wall clock.
 */

import type { Settings } from '../types/index.ts';
import { formatLocalDate } from './local-time.ts';
import { isTelegramTypeEligible, type TelegramEligibilitySettings } from './telegram-eligibility.ts';

export type QuietHoursConfig = Settings['timeLimits'];
export type AllowedHours = QuietHoursConfig['allowedHours'];

/** Restricted-page reason for a quiet-hours block. */
export const QUIET_HOURS_REASON = 'outside-hours' as const;

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function isWithinAllowedHours(ts: number, allowedHours: AllowedHours): boolean {
  const s = allowedHours.start * 60;
  const e = allowedHours.end * 60;
  if (s === e) return true;
  const m = minutesOfDay(new Date(ts));
  if (s < e) return m >= s && m < e;
  return m >= s || m < e;
}

export function isQuietNow(timeLimits: QuietHoursConfig, ts: number): boolean {
  return timeLimits.enabled === true && !isWithinAllowedHours(ts, timeLimits.allowedHours);
}

/**
 * Identifies one quiet period: the local calendar date (`YYYY-MM-DD`) on which it began,
 * or null when `ts` is inside the allowed window (or there are no quiet hours).
 */
export function quietWindowKey(ts: number, allowedHours: AllowedHours): string | null {
  const s = allowedHours.start * 60;
  const e = allowedHours.end * 60;
  if (s === e) return null;
  if (isWithinAllowedHours(ts, allowedHours)) return null;

  // Overnight allowed window: the quiet period [e, s) lies within one calendar day.
  if (s > e) return formatLocalDate(ts);

  // Same-day allowed window: quiet = [e, 24:00) + [00:00, s). The part after midnight
  // belongs to the period that began the previous evening.
  const d = new Date(ts);
  if (minutesOfDay(d) >= e) return formatLocalDate(ts);
  return formatLocalDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime());
}

export function shouldNotifyQuietHours(input: {
  eligible: boolean;
  windowKey: string | null;
  lastNotifiedKey: string | null | undefined;
}): boolean {
  return input.eligible && input.windowKey !== null && input.windowKey !== input.lastNotifiedKey;
}

/** Only http(s) pages are blocked: browser/extension pages and non-network schemes never are. */
export function isQuietHoursBlockable(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function isQuietHoursNotifyEligible(settings: TelegramEligibilitySettings): boolean {
  return isTelegramTypeEligible(settings, 'timeLimit');
}

/** 8 -> '08:00' */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
