/**
 * Navigation event handlers for tracking and restricting URLs
 */

import type { Settings, ClassificationResult, UrlCheckResult, VisitInfo, TelegramNoticeRef } from '../types';
import { getSettings, addHistoryEntry, getCachedClassification, cacheClassification, claimExplanation } from '../utils/storage';
import { checkUrl, isIgnored } from '../utils/url-matcher';
import { classifyPage } from '../utils/ai-classifier';
import { notifyRestrictedSite, notifyAllowedPathTelegram } from '../utils/telegram-notifier';
import { RESTRICTED_PAGE_PATH, STORAGE_KEYS } from '../utils/constants.js';
import { addSystemLog } from '../utils/system-logger';
import { enforceQuietHours } from './quiet-hours-handler';
import { finishExplanation, recordNoticeRef, startExplanation, waitForExplanation, type BlockNotice } from './explanation-runner';
import { isAiClassificationActive, resolveAiMode } from '../core/ai-mode.ts';
import { planExplanation, withoutTelegramNotice } from '../core/explanation.ts';
import { QUIET_HOURS_REASON } from '../core/quiet-hours.ts';
import { buildReasonDetails, type RestrictedInfo } from '../core/restricted-info.ts';
import { isRestrictedSiteNotifyEligible } from '../core/telegram-eligibility.ts';
import { selectNoticeVariant } from '../core/telegram-block-message.ts';

/**
 * Handle navigation before it completes
 * Blocks restricted sites immediately
 */
export async function handleBeforeNavigate(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails
): Promise<void> {
  // Ignore subframes and chrome:// pages
  if (details.frameId !== 0 || details.url.startsWith('chrome://') || details.url.startsWith('chrome-extension://')) {
    return;
  }

  let settings: Settings | undefined;
  try {
    settings = await getSettings();

    // Check if site is ignored - if so, skip classification checks
    const isSiteIgnored = isIgnored(details.url, settings.ignoredPatterns || []);
    
    // Check if Content Restrictions are enabled and we need to check cache
    let classification: ClassificationResult | null = null;
    if (!isSiteIgnored && settings.enableAIClassification && 
        ((settings.restrictedCategories?.length ?? 0) > 0 || (settings.restrictedSafetyLevels?.length ?? 0) > 0)) {
      // Try to get classification from cache for Content Restrictions check
      classification = await getCachedClassification(details.url);
    }

    // Check URL patterns and Content Restrictions (using cache if available)
    const checkResult = await checkUrl(details.url, settings, classification);
    if (checkResult.restricted) {
      await blockNavigation(details, checkResult, settings, classification);
      return;
    }
    
    // If Content Restrictions are enabled but no cache exists, we'll classify in handleCompletedNavigation
    // and block on next visit if needed
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error checking restriction in onBeforeNavigate:', errorMessage);
    await addSystemLog('system', `Navigation check failed: ${errorMessage}`);
  }

  // Quiet hours run after the restricted-list / content check above (which returns early on a block)
  // and never use its 'allowed' result as an exit: allow-listed and educational sites are blocked too.
  // Kept outside the try so a throwing checkUrl / cache lookup does not skip the quiet-hours check.
  if (settings) {
    await enforceQuietHours(details, settings);
  }
}

/**
 * Block navigation and redirect to restricted page.
 *
 * Two-stage mode: when the decision model blocked a page and no explanation was attempted for this cache entry,
 * this event claims Stage 2. The child is redirected and the Telegram notice is sent at once (never delayed);
 * the reason and suggestion are produced afterwards, at the tail of this handler, and the same notice is edited.
 */
async function blockNavigation(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails | chrome.webNavigation.WebNavigationFramedCallbackDetails,
  checkResult: UrlCheckResult,
  settings: Settings,
  classification?: ClassificationResult | null
): Promise<void> {
  console.log('Restricted site detected in onBeforeNavigate:', details.url, 'Reason:', checkResult.reason);

  const startedAt = Date.now();
  const plan = planExplanation(classification, settings, checkResult.reason, startedAt);
  let claimed: ClassificationResult | null = null;
  if (plan.action === 'run' && classification) {
    try {
      claimed = await claimExplanation(details.url, classification.classifiedAt, startedAt);
    } catch (e) {
      console.error('Could not claim the explanation:', e);
    }
  }
  // Concurrent with the redirect, notice and bookkeeping below; awaited at the tail.
  const explanation = claimed ? startExplanation(settings, claimed) : null;
  // What the block page, Telegram and history show first: the claimed entry carries the synthesized reason.
  const shown = claimed ?? classification;

  try {
    // Encode URL to pass it as query parameter
    const encodedUrl = encodeURIComponent(details.url);
    // Also include suggested educational URL if available
    const suggestedUrl = shown?.suggestedUrl || shown?.suggestedEducationalResource || null;
    let restrictedPageUrl = `${RESTRICTED_PAGE_PATH}?url=${encodedUrl}`;
    if (suggestedUrl) {
      restrictedPageUrl += `&suggestedUrl=${encodeURIComponent(suggestedUrl)}`;
    }
    // Add reason information to query params
    if (checkResult.reason) {
      restrictedPageUrl += `&reason=${encodeURIComponent(checkResult.reason)}`;
    }
    if (shown?.category) {
      restrictedPageUrl += `&category=${encodeURIComponent(shown.category)}`;
    }
    if (shown?.safetyLevel) {
      restrictedPageUrl += `&safetyLevel=${encodeURIComponent(shown.safetyLevel)}`;
    }
    if (shown?.reason) {
      restrictedPageUrl += `&classificationReason=${encodeURIComponent(shown.reason)}`;
    }
    if (claimed) {
      restrictedPageUrl += `&reasonPending=1`;
    }
    if (checkResult.matchedPattern) {
      restrictedPageUrl += `&matchedPattern=${encodeURIComponent(checkResult.matchedPattern)}`;
    }
    const restrictedUrl = chrome.runtime.getURL(restrictedPageUrl);
    await chrome.tabs.update(details.tabId, { url: restrictedUrl });
  } catch (e) {
    console.error('Failed to redirect to restricted page:', e);
  }

  let pageTitle = '';
  try {
    const tab = await chrome.tabs.get(details.tabId);
    pageTitle = tab.title || '';
  } catch {
    // Tab may not be available yet
  }

  // Exactly one Telegram message per block event. The owner of Stage 2 sends it in its `pending` layout and
  // remembers where it went so the tail can edit it; everyone else sends the plain layout and never edits.
  const notice: BlockNotice = {
    sentAt: Date.now(),
    pageTitle,
    reasonCode: checkResult.reason,
    matchedPattern: checkResult.matchedPattern,
  };
  let noticeRef: TelegramNoticeRef | null = null;
  const variant = selectNoticeVariant({
    eligible: isRestrictedSiteNotifyEligible(settings),
    planned: claimed !== null,
  });
  if (variant === 'pending' && claimed) {
    const sent = await notifyRestrictedSite(settings, details.url, checkResult.reason, checkResult.matchedPattern, {
      classification: claimed,
      pageTitle,
      explanation: 'pending',
      sentAt: notice.sentAt,
    });
    if (sent && sent.messageId !== null) {
      try {
        noticeRef = await recordNoticeRef({
          url: details.url,
          settings,
          claimed,
          sent: { chatId: sent.chatId, messageId: sent.messageId },
          notice,
        });
      } catch (e) {
        console.error('Could not record the Telegram notice reference:', e);
      }
    }
  } else {
    await notifyRestrictedSite(settings, details.url, checkResult.reason, checkResult.matchedPattern, {
      classification: shown ?? undefined,
      pageTitle,
    });
  }

  // Store restricted URL info for later history entry
  // Include suggested educational resource URL if available from classification
  const suggestedUrl = shown?.suggestedUrl || shown?.suggestedEducationalResource || null;
  
  const restrictedInfo: RestrictedInfo = {
    url: details.url,
    timestamp: details.timeStamp || Date.now(),
    reason: checkResult.reason,
    matchedPattern: checkResult.matchedPattern,
    tabId: details.tabId,
    suggestedUrl: suggestedUrl,
    category: shown?.category || null,
    safetyLevel: shown?.safetyLevel || null,
    classificationReason: shown?.reason || null,
    reasonDetails: buildReasonDetails(checkResult.reason, checkResult.matchedPattern, shown),
    // Only a block that owns Stage 2 carries the pending state; every other block page behaves as before.
    ...(claimed ? { noUrlReason: claimed.noUrlReason ?? null, reasonPending: true, explanationStatus: 'pending' as const } : {}),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.LAST_RESTRICTED_URL]: restrictedInfo });

  const title = pageTitle.trim() ? pageTitle : 'Restricted Site';

  // Save to history immediately to ensure it's captured
  const visitInfo: VisitInfo = {
    visitTime: details.timeStamp || Date.now(),
    transition: (details as any).transition || 'unknown'
  };

  await addHistoryEntry({
    url: details.url,
    title: title,
    timestamp: details.timeStamp || Date.now(),
    restricted: true,
    reason: checkResult.reason,
    matchedPattern: checkResult.matchedPattern || undefined,
    // History never keeps the Telegram message reference (a cached entry can still carry one)
    classification: shown ? withoutTelegramNotice(shown) : undefined,
    visits: [visitInfo],
    visitCount: 1
  });

  // Tail: wait for Stage 2 (keeps the service worker alive), then settle cache, history, block page and the notice.
  if (claimed && explanation) {
    const outcome = await waitForExplanation(explanation);
    await finishExplanation({
      url: details.url,
      settings,
      claimed,
      outcome,
      notice,
      ref: noticeRef,
    });
  }
}

// Removed: blockNavigationAsync function is no longer needed
// Blocking is now based only on URL patterns, not classification

/**
 * Handle completed navigation
 * Works in both normal and incognito mode
 */
export async function handleCompletedNavigation(
  details: chrome.webNavigation.WebNavigationFramedCallbackDetails
): Promise<void> {
  // Ignore subframes and chrome:// pages
  if (details.frameId !== 0 || details.url.startsWith('chrome://') || details.url.startsWith('chrome-extension://')) {
    return;
  }

  try {
    const settings = await getSettings();

    // Check if this is a redirect to restricted page
    if (details.url.includes('/pages/restricted.html')) {
      await handleRestrictedPageRedirect(details, settings);
      return;
    }

    // Quiet hours safety net: blocked pages are not classified or recorded.
    if (await enforceQuietHours(details, settings)) {
      return;
    }

    // Get tab info
    let isIncognito = false;
    let title = '';

    try {
      const tab = await chrome.tabs.get(details.tabId);
      isIncognito = tab.incognito || false;
      title = tab.title || '';
    } catch (e) {
      // Tab may have been closed - this is normal, handle gracefully
      const errorMessage = e instanceof Error ? e.message : String(e);
      if (errorMessage.includes('No tab with id')) {
        console.log(`Tab ${details.tabId} was closed, using defaults`);
      } else {
        console.error('Error getting tab info:', e);
      }
    }

    // Create visit info for this navigation
    const visitInfo: VisitInfo = {
      visitTime: details.timeStamp || Date.now(),
      transition: (details as any).transition || 'unknown'
    };

    // AI classification (if enabled and site is not ignored)
    let classification: ClassificationResult | null = null;
    const isSiteIgnored = isIgnored(details.url, settings.ignoredPatterns || []);
    
    if (!isSiteIgnored && isAiClassificationActive(settings)) {
      // Check cache
      const cached = await getCachedClassification(details.url);
      if (cached) {
        classification = cached;
        // Log cache hit
        await addSystemLog('ai', `Using cached classification`, `URL: ${details.url}\nCached at: ${cached.cachedAt ? new Date(cached.cachedAt).toISOString() : 'unknown'}\nClassification: ${JSON.stringify({isEducational: cached.isEducational ?? cached.educational, category: cached.category, safetyLevel: cached.safetyLevel, suggestedUrl: cached.suggestedUrl ?? cached.suggestedEducationalResource}, null, 2)}`);
      } else {
        // Classify via API
        const mode = resolveAiMode(settings);
        await addSystemLog('ai', `Starting classification`, `URL: ${details.url}, Title: ${title || 'No title'}, Mode: ${mode}, Model: ${mode === 'two-stage' ? settings.decisionModel : settings.aiModel || 'default'}`);
        classification = await classifyPage(details.url, title, settings);
        if (classification && !classification.error) {
          await cacheClassification(details.url, classification);
          await addSystemLog('ai', `Classification completed and cached`, `URL: ${details.url}\nResult: ${JSON.stringify({isEducational: classification.isEducational ?? classification.educational, category: classification.category, safetyLevel: classification.safetyLevel, suggestedUrl: classification.suggestedUrl ?? classification.suggestedEducationalResource}, null, 2)}`);
        } else if (classification && classification.error) {
          await addSystemLog('ai', `Classification failed`, `URL: ${details.url}\nError: ${classification.reason || 'Unknown error'}`);
        }
      }

      // Telegram: merged "detection + access/restriction" is sent after checkUrl below
    } else if (isSiteIgnored) {
      // Log that site is ignored
      await addSystemLog('ai', `Site ignored, skipping classification`, `URL: ${details.url}`);
    }

    // Check restriction via our url-matcher (includes Content Restrictions check)
    const checkResult = await checkUrl(details.url, settings, classification);
    
    // If Content Restrictions block this page, redirect to restricted page
    if (checkResult.restricted && checkResult.reason === 'content-restricted') {
      await blockNavigation(details, checkResult, settings, classification);
      return;
    }

    // If site is restricted, send notification (fallback if onBeforeNavigate didn't fire)
    if (checkResult.restricted) {
      // Only send notification if we didn't already send it in onBeforeNavigate
      const stored = await chrome.storage.local.get([STORAGE_KEYS.LAST_RESTRICTED_URL]);
      if (!stored[STORAGE_KEYS.LAST_RESTRICTED_URL] || stored[STORAGE_KEYS.LAST_RESTRICTED_URL].url !== details.url) {
        await notifyRestrictedSite(settings, details.url, checkResult.reason, checkResult.matchedPattern, {
          classification: classification ?? undefined,
          pageTitle: title,
        });
      }

      // Save to history as restricted attempt
      await addHistoryEntry({
        url: details.url,
        title: title,
        timestamp: details.timeStamp || Date.now(),
        restricted: true,
        reason: checkResult.reason,
        matchedPattern: checkResult.matchedPattern || undefined,
        classification: classification || undefined,
        incognito: isIncognito,
        visits: [visitInfo],
        visitCount: 1
      });

      return;
    }

    // If site is allowed: one Telegram merges classification (if any) + access allowed
    if (checkResult.reason === 'allowed') {
      await notifyAllowedPathTelegram(settings, details.url, title, classification, checkResult.reason);
    }

    // Save to history
    await addHistoryEntry({
      url: details.url,
      title: title,
      timestamp: details.timeStamp || Date.now(),
      restricted: false,
      classification: classification || undefined,
      incognito: isIncognito,
      visits: [visitInfo],
      visitCount: 1
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error processing navigation:', errorMessage);
    await addSystemLog('system', `Navigation processing failed: ${errorMessage}`);
  }
}

/**
 * Handle redirect to restricted page
 */
async function handleRestrictedPageRedirect(
  details: chrome.webNavigation.WebNavigationFramedCallbackDetails,
  settings: Settings
): Promise<void> {
  // Quiet-hours blocks are not history entries and must not be notified as restricted sites.
  if (details.url.includes(`reason=${QUIET_HOURS_REASON}`)) {
    return;
  }
  console.log('Redirect to restricted page detected');
  // Get the original restricted URL from storage
  const stored = await chrome.storage.local.get([STORAGE_KEYS.LAST_RESTRICTED_URL]);
  let restrictedInfo = stored[STORAGE_KEYS.LAST_RESTRICTED_URL];
  if (restrictedInfo?.reason === QUIET_HOURS_REASON) {
    return;
  }
  
  // If no stored URL found, try to get it from tab history (for declarativeNetRequest redirects)
  if (!restrictedInfo || restrictedInfo.tabId !== details.tabId) {
    console.log('No stored URL found, trying to get from tab history');
    try {
      const tab = await chrome.tabs.get(details.tabId);
      // Try to get previous URL from tab's pending URL or navigation history
      // For declarativeNetRequest redirects, we can check the referrer
      if (tab.pendingUrl && tab.pendingUrl !== details.url) {
        const previousUrl = tab.pendingUrl;
        console.log('Found previous URL from tab.pendingUrl:', previousUrl);
        // Check if this URL should be restricted
        const checkResult = await checkUrl(previousUrl, settings);
        if (checkResult.restricted) {
          // Try to get classification from cache
          const classification = await getCachedClassification(previousUrl);
          const suggestedUrl = classification?.suggestedUrl || classification?.suggestedEducationalResource || null;
          
          const reasonDetails = buildReasonDetails(checkResult.reason, checkResult.matchedPattern, classification);
          restrictedInfo = {
            url: previousUrl,
            timestamp: details.timeStamp || Date.now(),
            reason: checkResult.reason,
            matchedPattern: checkResult.matchedPattern,
            tabId: details.tabId,
            suggestedUrl: suggestedUrl,
            category: classification?.category || null,
            safetyLevel: classification?.safetyLevel || null,
            classificationReason: classification?.reason || null,
            reasonDetails
          };
          // Save to storage for the restricted page to read
          await chrome.storage.local.set({
            [STORAGE_KEYS.LAST_RESTRICTED_URL]: restrictedInfo
          });
        }
      }
    } catch (e) {
      console.warn('Could not get tab info:', e);
    }
  }
  
  if (restrictedInfo && restrictedInfo.tabId === details.tabId) {
    console.log('Found stored restricted URL:', restrictedInfo.url);

    // Notification was already sent in onBeforeNavigate, but ensure it's sent again if needed
    await notifyRestrictedSite(settings, restrictedInfo.url, restrictedInfo.reason, restrictedInfo.matchedPattern);

    // Save to history as restricted attempt
    let isIncognito = false;
    let title = 'Restricted Site';
    try {
      const tab = await chrome.tabs.get(details.tabId);
      isIncognito = tab.incognito || false;
      title = tab.title || 'Restricted Site';
    } catch (e) {
      // Tab may have been closed
    }

    const visitInfo: VisitInfo = {
      visitTime: restrictedInfo.timestamp || Date.now(),
      transition: (details as any).transition || 'unknown'
    };

    await addHistoryEntry({
      url: restrictedInfo.url,
      title: title,
      timestamp: restrictedInfo.timestamp || Date.now(),
      restricted: true,
      reason: restrictedInfo.reason,
      matchedPattern: restrictedInfo.matchedPattern || undefined,
      incognito: isIncognito,
      visits: [visitInfo],
      visitCount: 1
    });

    // Don't remove URL from storage immediately - let the restricted page read it first
    // It will be cleared when the page loads or after a timeout
  } else {
    console.warn('No stored restricted URL found for tab:', details.tabId);
  }
}
