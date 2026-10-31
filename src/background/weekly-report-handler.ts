/**
 * Weekly report scheduling: an hourly alarm wakes the service worker, the due-check state lives in
 * chrome.storage.local (nothing in memory is needed for correctness), and the decisions come from
 * src/core/weekly-report.ts.
 *
 * No double send: (1) one check at a time per worker (single-flight), (2) the attempt stamp is
 * written before the HTTP call and gates a new attempt for 60 minutes (restarts, overlapping
 * triggers, retry back-off), (3) only the non-incognito worker checks (split mode runs a second
 * worker that shares storage.local), (4) lastWeeklyReportAt moves the next due time 7 days out.
 */

import { getHistory, getSettings } from '../utils/storage';
import { sendWeeklyReport } from '../utils/telegram-notifier';
import { addSystemLog } from '../utils/system-logger';
import { ALARM_NAMES, STORAGE_KEYS, WEEKLY_REPORT_CHECK_PERIOD_MINUTES } from '../utils/constants.js';
import { buildWeeklyStats, isWeeklyEligible, readWeeklyState, weeklyReportAction } from '../core/weekly-report.ts';

let inFlight: Promise<void> | null = null;

async function checkOnce(now: number): Promise<void> {
  // chrome.extension.inIncognitoContext is true only in the incognito worker of a split-mode extension.
  if (chrome.extension?.inIncognitoContext === true) return;

  const settings = await getSettings();
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.LAST_WEEKLY_REPORT_AT,
    STORAGE_KEYS.WEEKLY_REPORT_ANCHOR_AT,
    STORAGE_KEYS.WEEKLY_REPORT_LAST_ATTEMPT_AT,
  ]);
  const action = weeklyReportAction(readWeeklyState(stored), isWeeklyEligible(settings), now);

  switch (action) {
    case 'clear-anchor':
      await chrome.storage.local.remove(STORAGE_KEYS.WEEKLY_REPORT_ANCHOR_AT);
      return;
    case 'set-anchor':
      await chrome.storage.local.set({ [STORAGE_KEYS.WEEKLY_REPORT_ANCHOR_AT]: now });
      return;
    case 'send': {
      // Stamp first: a crash or failure between here and the send never causes a retry storm.
      await chrome.storage.local.set({ [STORAGE_KEYS.WEEKLY_REPORT_LAST_ATTEMPT_AT]: now });
      const stats = buildWeeklyStats(await getHistory(), now);
      if (await sendWeeklyReport(settings, stats)) {
        await chrome.storage.local.set({ [STORAGE_KEYS.LAST_WEEKLY_REPORT_AT]: now });
        await chrome.storage.local.remove(STORAGE_KEYS.WEEKLY_REPORT_ANCHOR_AT);
        await addSystemLog('system', `Weekly report sent (${stats.periodStart} - ${stats.periodEnd})`);
      } else {
        await addSystemLog('system', 'Weekly report was not sent; it will be retried in about an hour');
      }
      return;
    }
    case 'wait':
    case 'none':
      return;
  }
}

/**
 * Runs the due-check. Concurrent callers share one run; never rejects.
 */
export function runWeeklyReportCheck(now: number = Date.now()): Promise<void> {
  if (inFlight) return inFlight;

  const run = checkOnce(now)
    .catch(async (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Weekly report check failed:', message);
      await addSystemLog('system', `Weekly report check failed: ${message}`);
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}

/**
 * Creates the hourly check alarm if it is missing or has another period.
 * Re-creating restarts the countdown, so an existing alarm is left alone.
 * Resolves true when the alarm had to be created.
 */
export async function ensureWeeklyReportAlarm(): Promise<boolean> {
  // chrome.alarms.get resolves undefined when the alarm does not exist (typings say Alarm).
  const existing: chrome.alarms.Alarm | undefined = await chrome.alarms.get(ALARM_NAMES.WEEKLY_REPORT_CHECK);
  if (existing?.periodInMinutes === WEEKLY_REPORT_CHECK_PERIOD_MINUTES) return false;

  await chrome.alarms.create(ALARM_NAMES.WEEKLY_REPORT_CHECK, { periodInMinutes: WEEKLY_REPORT_CHECK_PERIOD_MINUTES });
  return true;
}
