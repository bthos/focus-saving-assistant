/**
 * History sync utility - captures browser history using chrome.history API
 * Based on approach from History-Trends-Unlimited example
 */

import { HistoryEntry, VisitInfo } from '../types';

export interface HistorySyncResult {
  entries: HistoryEntry[];
  maxVisitTimeSeen: number;
  syncStartTime: number;
}

/**
 * Get browser history using chrome.history API
 * Implements incremental sync - only fetches visits since last sync time
 * Note: chrome.history API doesn't work in incognito mode, so this will return empty results
 * Pages visited in incognito mode are captured via webNavigation.onCompleted instead
 */
export async function syncBrowserHistory(
  lastSyncTime: number = 0,
  ignoreVisitsDurationSeconds: number = 0
): Promise<HistorySyncResult> {
  const nowMilliseconds = Date.now();
  
  // Ignore the lastSyncTime if it's in the future
  if (lastSyncTime && lastSyncTime > nowMilliseconds) {
    console.log(`Ignoring a last sync time in the future: ${new Date(lastSyncTime).toString()}`);
    lastSyncTime = 0;
  }

  const syncStartTime = lastSyncTime + 1;
  console.log(`Finding visits since ${syncStartTime} (${new Date(syncStartTime).toISOString()})`);

  let historyItems: chrome.history.HistoryItem[] = [];
  try {
    // Search for all history items since last sync
    // Note: In incognito mode, this will return empty array
    historyItems = await chrome.history.search({
      text: '', // Return every history item
      maxResults: 1000000000, // Large number to get all results
      startTime: syncStartTime
    });
  } catch (error) {
    // chrome.history API may fail in incognito mode or if permission is revoked
    console.log('chrome.history API not available (likely incognito mode):', error);
    // Return empty result - pages will be captured via webNavigation.onCompleted instead
    return {
      entries: [],
      maxVisitTimeSeen: lastSyncTime,
      syncStartTime
    };
  }

  const entries: HistoryEntry[] = [];
  const ignoreMilliseconds = ignoreVisitsDurationSeconds * 1000;
  let maxVisitTimeSeen = syncStartTime;

  for (const historyItem of historyItems) {
    // Skip items without URL
    if (!historyItem.url) {
      continue;
    }
    
    // Skip chrome:// and chrome-extension:// URLs
    if (historyItem.url.startsWith('chrome://') || 
        historyItem.url.startsWith('chrome-extension://')) {
      continue;
    }

    // Get detailed visit information
    const visitItems = await chrome.history.getVisits({ url: historyItem.url });
    const acceptableVisits: VisitInfo[] = [];

    // Sort by visitTime, ascending (filter out items without visitTime)
    const validVisitItems = visitItems.filter(v => v.visitTime !== undefined);
    validVisitItems.sort((a, b) => (a.visitTime || 0) - (b.visitTime || 0));

    let previousVisitTime = 0;
    for (const visitItem of validVisitItems) {
      const currentVisitTime = visitItem.visitTime || 0;

      // Ignore visits prior to the syncStartTime
      if (currentVisitTime < syncStartTime) {
        continue;
      }

      // Ignore visits that occurred too close to the previous visit
      // (to filter out rapid refreshes or redirects)
      if (currentVisitTime - previousVisitTime > ignoreMilliseconds) {
        acceptableVisits.push({
          visitTime: currentVisitTime,
          transition: visitItem.transition || 'unknown',
          visitId: visitItem.visitId?.toString()
        });
      }
      previousVisitTime = currentVisitTime;

      // Track the highest visit time seen, being careful to ignore future visits
      if ((currentVisitTime <= nowMilliseconds) && (currentVisitTime > maxVisitTimeSeen)) {
        maxVisitTimeSeen = currentVisitTime;
      }
    }

    // Only add entries that have visits in our time range
    if (acceptableVisits.length > 0) {
      // Use the most recent visit as the main entry
      const mostRecentVisit = acceptableVisits[acceptableVisits.length - 1];
      
      entries.push({
        id: Date.now() + Math.random(),
        url: historyItem.url!,
        title: historyItem.title || historyItem.url!,
        timestamp: mostRecentVisit.visitTime,
        restricted: false, // Will be determined by our restriction logic
        visits: acceptableVisits,
        visitCount: acceptableVisits.length
      });
    }
  }

  console.log(`Synced ${entries.length} history entries, max visit time: ${maxVisitTimeSeen}`);

  return {
    entries,
    maxVisitTimeSeen,
    syncStartTime
  };
}
