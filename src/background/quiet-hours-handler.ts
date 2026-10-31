/**
 * Quiet hours enforcement: outside the allowed hours every http(s) page is redirected to the
 * restricted page (reason `outside-hours`). No exemptions, no classification lookup, no history
 * entry and no `restricted` notification: quiet-hours blocks must not mark URLs as restricted.
 * All decisions come from src/core/quiet-hours.ts; this module only does the I/O around them.
 */

import type { Settings } from '../types';
import { getSettings } from '../utils/storage';
import { notifyQuietHoursAttempt } from '../utils/telegram-notifier';
import { addSystemLog } from '../utils/system-logger';
import { RESTRICTED_PAGE_PATH, STORAGE_KEYS } from '../utils/constants.js';
import {
  QUIET_HOURS_REASON,
  isQuietHoursBlockable,
  isQuietHoursNotifyEligible,
  isQuietNow,
  quietWindowKey,
  shouldNotifyQuietHours,
} from '../core/quiet-hours.ts';

// In-memory claim of the quiet period already handled by this worker. beforeNavigate, completed and
// history-state events for one attempt fire within milliseconds; the synchronous check-and-set below
// keeps them from each sending a message. The persisted key covers worker restarts.
let claimedWindowKey: string | null = null;

/**
 * Redirects the tab to the restricted page when quiet hours apply to this URL.
 * Resolves true only when this call redirected the tab.
 */
export async function enforceQuietHours(
  details: { tabId: number; url: string; timeStamp?: number },
  settings: Settings,
  now: number = Date.now()
): Promise<boolean> {
  if (details.tabId < 0 || !isQuietHoursBlockable(details.url) || !isQuietNow(settings.timeLimits, now)) {
    return false;
  }

  // Info for the block page; replaced (not merged) so no stale suggestion or reason details survive.
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.LAST_RESTRICTED_URL]: {
        url: details.url,
        timestamp: details.timeStamp ?? now,
        reason: QUIET_HOURS_REASON,
        tabId: details.tabId,
      },
    });
  } catch (error) {
    console.error('Failed to store quiet-hours block info:', error);
  }

  try {
    const restrictedPageUrl = `${RESTRICTED_PAGE_PATH}?url=${encodeURIComponent(details.url)}&reason=${QUIET_HOURS_REASON}`;
    await chrome.tabs.update(details.tabId, { url: chrome.runtime.getURL(restrictedPageUrl) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Failed to redirect to restricted page (quiet hours):', message);
    await addSystemLog('system', `Quiet hours redirect failed: ${message}`);
    return false;
  }

  // A notification failure must never change the block result.
  try {
    await notifyQuietHoursOncePerWindow(settings, details.url, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Quiet hours notification failed:', message);
    await addSystemLog('system', `Quiet hours notification failed: ${message}`);
  }
  return true;
}

/**
 * Sends the Telegram message on the first blocked attempt of each quiet period (at most once, even
 * when the send fails: the key is claimed first). While Telegram is not eligible nothing is claimed,
 * so enabling it later the same night still notifies.
 */
async function notifyQuietHoursOncePerWindow(settings: Settings, url: string, now: number): Promise<void> {
  const { allowedHours } = settings.timeLimits;
  const windowKey = quietWindowKey(now, allowedHours);
  const eligible = isQuietHoursNotifyEligible(settings);

  if (!shouldNotifyQuietHours({ eligible, windowKey, lastNotifiedKey: claimedWindowKey })) return;
  claimedWindowKey = windowKey; // before any await

  const key = STORAGE_KEYS.LAST_QUIET_HOURS_NOTIFIED_WINDOW;
  const stored = (await chrome.storage.local.get([key]))[key];
  if (!shouldNotifyQuietHours({ eligible, windowKey, lastNotifiedKey: typeof stored === 'string' ? stored : null })) return;

  await chrome.storage.local.set({ [key]: windowKey });

  let host = 'unknown site';
  try {
    host = new URL(url).hostname || host;
  } catch {
    // keep the placeholder
  }
  await addSystemLog('system', `Quiet hours: first blocked attempt of the period starting ${windowKey} (${host})`);

  // The boolean is ignored on purpose: a failed send is logged by sendTelegramMessage and not retried tonight.
  await notifyQuietHoursAttempt(settings, url, allowedHours);
}

/**
 * Single-page apps change the URL without a real navigation; catch those too (top frame only).
 */
export async function handleHistoryStateUpdated(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails
): Promise<void> {
  if (details.frameId !== 0 || !isQuietHoursBlockable(details.url)) return;

  try {
    const settings = await getSettings();
    await enforceQuietHours(details, settings);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error checking quiet hours in onHistoryStateUpdated:', message);
    await addSystemLog('system', `Quiet hours check failed: ${message}`);
  }
}
