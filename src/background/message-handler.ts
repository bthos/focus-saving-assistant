/**
 * Message handlers for communication with other parts of the extension
 */

import { getSettings } from '../utils/storage';
import { checkUrl } from '../utils/url-matcher';
// Classification import removed - no longer used for blocking
import { loadRestrictionRules } from './rules-manager';
import { syncHistoryFromBrowser } from './history-sync-handler';
import { addSystemLog } from '../utils/system-logger';
import { MESSAGE_TYPES } from '../utils/constants.js';

/**
 * Handle messages from other parts of the extension
 */
export function setupMessageHandlers(): void {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === MESSAGE_TYPES.RELOAD_RULES) {
      loadRestrictionRules().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      });
      return true; // Async response
    }

    if (message.type === MESSAGE_TYPES.SYNC_HISTORY) {
      syncHistoryFromBrowser().then(() => {
        sendResponse({ success: true });
      }).catch(error => {
        sendResponse({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
      });
      return true; // Async response
    }

    if (message.type === MESSAGE_TYPES.CHECK_RESTRICTED) {
      handleCheckRestricted(message.url).then(result => {
        sendResponse(result);
      }).catch(error => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('Error in checkRestricted handler:', error);
        addSystemLog('system', `URL check failed: ${errorMessage}`, `URL: ${message.url}`).then(() => {
          sendResponse({ restricted: false, error: errorMessage });
        });
      });
      return true; // Async response
    }

    return false;
  });
}

/**
 * Check if URL is restricted
 */
async function handleCheckRestricted(url: string): Promise<{
  restricted: boolean;
  reason?: string;
  matchedPattern?: string | null;
  error?: string;
}> {
  const settings = await getSettings();

  try {
    // Check URL patterns only (blocking is based on URL patterns, not classification)
    const checkResult = await checkUrl(url, settings, null);
    return {
      restricted: checkResult.restricted,
      reason: checkResult.reason,
      matchedPattern: checkResult.matchedPattern
    };
  } catch (checkError) {
    const errorMessage = checkError instanceof Error ? checkError.message : String(checkError);
    console.error('Error in checkRestricted handler:', checkError);
    await addSystemLog('system', `URL check failed: ${errorMessage}`, `URL: ${url}`);
    return { restricted: false, error: errorMessage };
  }
}
