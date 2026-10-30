/**
 * History synchronization handler
 */

import { getLastHistorySyncTime, setLastHistorySyncTime, mergeAndSaveHistory } from '../utils/storage';
import { syncBrowserHistory } from '../utils/history-sync';
import { addSystemLog } from '../utils/system-logger';
import { HISTORY_SYNC_IGNORE_VISITS_SECONDS } from '../utils/constants.js';

/**
 * Sync browser history using chrome.history API
 */
export async function syncHistoryFromBrowser(): Promise<void> {
  try {
    const lastSyncTime = await getLastHistorySyncTime();
    const syncResult = await syncBrowserHistory(lastSyncTime, HISTORY_SYNC_IGNORE_VISITS_SECONDS);

    if (syncResult.entries.length > 0) {
      await mergeAndSaveHistory(syncResult.entries);
      console.log(`Synced ${syncResult.entries.length} history entries`);
    }

    // Update last sync time
    await setLastHistorySyncTime(syncResult.maxVisitTimeSeen);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error syncing browser history:', errorMessage);
    await addSystemLog('system', `History sync failed: ${errorMessage}`);
  }
}
