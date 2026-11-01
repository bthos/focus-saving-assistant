/**
 * Restricted page logic
 *
 * Two-stage mode: the page first shows the reason the extension synthesized, then updates in place (no reload)
 * when the explanation model has answered: the background rewrites chrome.storage.local.lastRestrictedUrl and
 * this page listens for that change. This is a classic script (no imports), so it carries its own small copy of
 * the display rules; the pure parts that build the stored value live in core/restricted-info.ts.
 */

/** What the page knows about the block (query seed first, then the stored lastRestrictedUrl). */
interface PageBlockInfo {
  reason: string | null;
  category: string | null;
  safetyLevel: string | null;
  classificationReason: string | null;
  matchedPattern: string | null;
  reasonDetails: string[] | null;
  suggestedUrl: string | null;
  noUrlReason: string | null;
}

/** The lastRestrictedUrl storage value, as far as this page reads it. */
interface PageStoredBlock extends Partial<PageBlockInfo> {
  url?: string;
  tabId?: number;
  reasonPending?: boolean;
  explanationStatus?: 'pending' | 'done' | 'failed';
}

type ExplanationViewState = 'none' | 'pending' | 'ready' | 'failed' | 'timedOut';

const PENDING_UI_TIMEOUT_MS = 30000;
const STATUS_TEXT = {
  pending: '⏳ Preparing a detailed explanation…',
  ready: '✓ Detailed explanation ready.',
  unavailable: 'Detailed explanation not available.',
};
const SUGGESTION_CAPTION = 'Suggested by an AI model. The page may not exist or may have changed.';

/** The blocked URL exactly as lastRestrictedUrl.url holds it: the only value matched against storage. */
let blockUrl: string | null = null;
let blockInfo: PageBlockInfo | null = null;
/** True when this block's explanation is handled by two-stage mode (shows status line and caption). */
let explanationOwned = false;
let viewState: ExplanationViewState = 'none';
let currentSuggestion: string | null = null;
let pendingTimer: number | undefined;

// Registered before the first storage read, so a result that lands in between is not missed.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes.lastRestrictedUrl) return;
  handleStoredBlock(changes.lastRestrictedUrl.newValue as PageStoredBlock | undefined);
});

document.addEventListener('DOMContentLoaded', async () => {
  // Get URL from query parameters
  const urlParams = new URLSearchParams(window.location.search);
  let restrictedUrl = urlParams.get('url');

  let stored: PageStoredBlock | null = null;
  try {
    const result = await chrome.storage.local.get(['lastRestrictedUrl']);
    stored = (result.lastRestrictedUrl as PageStoredBlock | undefined) ?? null;
  } catch (error) {
    console.error('Error getting restricted info from storage:', error);
  }

  // If URL not in query params, try to get from storage (fallback)
  if (!restrictedUrl || restrictedUrl.trim() === '' || restrictedUrl === 'Unknown URL') {
    if (stored?.url) {
      restrictedUrl = stored.url;
      // Clear the stored URL after reading it (cleanup)
      // Use setTimeout to ensure the page has time to display it
      setTimeout(() => {
        chrome.storage.local.remove(['lastRestrictedUrl']).catch(err => {
          console.error('Error clearing stored URL:', err);
        });
      }, 1000);
    }
  }

  // `urlParams.get` already undid the encoding navigation-handler applied, so this is the URL exactly as stored
  // in lastRestrictedUrl.url. Storage is matched on this value only: the decoding below is for display.
  blockUrl = restrictedUrl || null;

  // Decode URL for display only
  if (restrictedUrl) {
    try {
      restrictedUrl = decodeURIComponent(restrictedUrl);
    } catch (e) {
      // If decoding fails, use as-is
      console.warn('Failed to decode URL:', e);
    }
  } else {
    restrictedUrl = 'Unknown URL';
  }

  // Display restricted URL
  const urlElement = document.getElementById('restrictedUrl');
  if (urlElement) {
    urlElement.textContent = restrictedUrl;
  }

  // Detailed reason information: first from query parameters, then from storage
  blockInfo = {
    reason: urlParams.get('reason') || null,
    category: urlParams.get('category') || null,
    safetyLevel: urlParams.get('safetyLevel') || null,
    classificationReason: urlParams.get('classificationReason') || null,
    matchedPattern: urlParams.get('matchedPattern') || null,
    reasonDetails: null,
    suggestedUrl: urlParams.get('suggestedUrl'),
    noUrlReason: null,
  };
  if (!blockInfo.reason && stored) {
    blockInfo = {
      reason: stored.reason || blockInfo.reason,
      category: stored.category || blockInfo.category,
      safetyLevel: stored.safetyLevel || blockInfo.safetyLevel,
      classificationReason: stored.classificationReason || blockInfo.classificationReason,
      matchedPattern: stored.matchedPattern || blockInfo.matchedPattern,
      reasonDetails: stored.reasonDetails || null,
      suggestedUrl: blockInfo.suggestedUrl,
      noUrlReason: null,
    };
  }
  if (!blockInfo.suggestedUrl && stored?.suggestedUrl) {
    blockInfo.suggestedUrl = stored.suggestedUrl;
  }

  // Two-stage state: only a stored value that describes this very URL counts. The query seeds "pending".
  const seededPending = urlParams.get('reasonPending') === '1';
  const own = stored && stored.url === blockUrl && hasExplanationFields(stored) ? stored : null;
  if (own) {
    blockInfo = mergeStoredBlock(blockInfo, own);
  }
  explanationOwned = own !== null || seededPending;
  const firstState = stateFromStored(own, seededPending);
  if (firstState === 'pending') {
    // The card grows when the suggestion appears; keep it where it is instead of re-centring it.
    document.body.classList.add('keep-position');
  }
  setViewState(firstState);
  await renderBlock();

  // Handle click on "Go to educational resource" button (registered once; reads the current suggestion)
  const goToEducationalBtn = document.getElementById('goToEducationalBtn');
  if (goToEducationalBtn) {
    goToEducationalBtn.addEventListener('click', navigateToSuggestion);
  }

  // Load settings to get message
  // Note: Using direct storage key since we can't import modules in this context
  try {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings as { restrictedPageMessage?: string } | undefined;
    const message = (settings?.restrictedPageMessage && settings.restrictedPageMessage.trim()) ||
      'This site has been restricted to help you stay focused.';

    const messageElement = document.getElementById('restrictedMessage');
    if (messageElement) {
      messageElement.textContent = message;
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }

  // Go back button
  const goBackBtn = document.getElementById('goBackBtn');
  if (goBackBtn) {
    goBackBtn.addEventListener('click', () => {
      window.history.back();
    });
  }

  // Request access button (if configured)
  // TODO: Implement access request functionality via Telegram
});

function hasExplanationFields(stored: PageStoredBlock): boolean {
  return stored.explanationStatus !== undefined || stored.reasonPending !== undefined;
}

function mergeStoredBlock(info: PageBlockInfo, stored: PageStoredBlock): PageBlockInfo {
  return {
    ...info,
    category: stored.category || info.category,
    safetyLevel: stored.safetyLevel || info.safetyLevel,
    classificationReason: stored.classificationReason || info.classificationReason,
    reasonDetails: stored.reasonDetails ?? info.reasonDetails,
    suggestedUrl: stored.suggestedUrl ?? null,
    noUrlReason: stored.noUrlReason ?? null,
  };
}

/** The stored status; a settled entry without a status counts as done. Without any stored value the query seed decides. */
function stateFromStored(stored: PageStoredBlock | null, seededPending: boolean): ExplanationViewState {
  const status = stored?.explanationStatus ?? (stored?.reasonPending === false ? 'done' : undefined);
  if (status === 'done') return 'ready';
  if (status === 'failed') return 'failed';
  if (status === 'pending') return 'pending';
  return seededPending ? 'pending' : 'none';
}

/** Sets the view state; a pending state starts the 30 s timer once, any other state stops it. */
function setViewState(next: ExplanationViewState): void {
  viewState = next;
  if (next === 'pending') {
    if (pendingTimer === undefined) {
      pendingTimer = window.setTimeout(() => {
        pendingTimer = undefined;
        if (viewState === 'pending') {
          viewState = 'timedOut';
          void renderBlock();
        }
      }, PENDING_UI_TIMEOUT_MS);
    }
  } else if (pendingTimer !== undefined) {
    window.clearTimeout(pendingTimer);
    pendingTimer = undefined;
  }
}

/** lastRestrictedUrl changed: apply it when it is the explanation result of the block shown here. */
function handleStoredBlock(value: PageStoredBlock | undefined): void {
  if (!value || !blockInfo) return;
  if (value.url !== blockUrl || value.reason !== blockInfo.reason) return;
  // A later plain block of the same URL carries no explanation fields; it must not reset a settled page.
  if (!hasExplanationFields(value)) return;
  blockInfo = mergeStoredBlock(blockInfo, value);
  explanationOwned = true;
  setViewState(stateFromStored(value, false));
  void renderBlock();
}

async function renderBlock(): Promise<void> {
  await renderReason();
  renderSuggestion();
}

/**
 * Blocking reason box, status line and note. The text of the reason is plain text (textContent), including
 * model-written text.
 */
async function renderReason(): Promise<void> {
  const info = blockInfo;
  const reasonInfoEl = document.getElementById('reasonInfo');
  const reasonDetailsEl = document.getElementById('reasonDetails');
  const statusEl = document.getElementById('reasonStatus');
  const noteEl = document.getElementById('reasonNote');
  if (!info || !info.reason || !reasonInfoEl || !reasonDetailsEl) return;

  let reasonText = '';

  if (info.reason === 'content-restricted') {
    reasonText = 'Content blocked based on classification:';
    if (info.reasonDetails && Array.isArray(info.reasonDetails)) {
      reasonText += '\n' + info.reasonDetails.join('\n');
    } else {
      // Build from individual fields
      const details: string[] = [];
      if (info.category) {
        details.push(`Category: ${info.category}`);
      }
      if (info.safetyLevel) {
        details.push(`Risk Level: ${info.safetyLevel}`);
      }
      if (info.classificationReason) {
        details.push(`Reason: ${info.classificationReason}`);
      }
      if (details.length > 0) {
        reasonText += '\n' + details.join('\n');
      } else {
        reasonText += '\nSite does not meet the established restrictions for category or risk level';
      }
    }
  } else if (info.reason === 'restricted') {
    reasonText = 'Site is in the restricted list';
    if (info.matchedPattern) {
      reasonText += `\nMatches rule: ${info.matchedPattern}`;
    }
  } else if (info.reason === 'outside-hours') {
    reasonText = await outsideHoursReasonText();
  } else {
    reasonText = `Reason: ${info.reason || 'Unknown'}`;
    if (info.matchedPattern) {
      reasonText += `\nMatches rule: ${info.matchedPattern}`;
    }
  }

  reasonDetailsEl.textContent = reasonText;
  reasonInfoEl.classList.remove('hidden');

  if (statusEl) {
    statusEl.textContent =
      viewState === 'pending' ? STATUS_TEXT.pending
      : viewState === 'ready' ? STATUS_TEXT.ready
      : viewState === 'failed' || viewState === 'timedOut' ? STATUS_TEXT.unavailable
      : '';
  }
  if (noteEl) {
    // Why there is no link, only for a finished explanation (the failed state's status line already says it).
    const note = viewState === 'ready' && !validatedSuggestion(info.suggestedUrl) ? (info.noUrlReason || '').trim() : '';
    noteEl.textContent = note ? `Suggestion: ${note}` : '';
    noteEl.classList.toggle('hidden', !note);
  }
}

/** Only http(s) links are offered, whatever produced them (defence in depth: the background validates too). */
function validatedSuggestion(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Suggested educational resource. Not shown while the explanation is pending or failed, and never for quiet
 * hours (they block everything, so a suggestion would be pointless).
 */
function renderSuggestion(): void {
  const info = blockInfo;
  const educationalSuggestionEl = document.getElementById('educationalSuggestion');
  const suggestedUrlEl = document.getElementById('suggestedUrl');
  const captionEl = document.getElementById('suggestionCaption');
  if (!info || !educationalSuggestionEl || !suggestedUrlEl) return;

  const isOutsideHours = info.reason === 'outside-hours';
  const settledOrPlain = viewState === 'none' || viewState === 'ready';
  currentSuggestion = !isOutsideHours && settledOrPlain ? validatedSuggestion(info.suggestedUrl) : null;

  if (!currentSuggestion) {
    educationalSuggestionEl.classList.add('hidden');
    return;
  }

  // Decode URL if needed
  let displayUrl = currentSuggestion;
  try {
    displayUrl = decodeURIComponent(currentSuggestion);
  } catch (e) {
    // Use as-is if decoding fails
  }
  suggestedUrlEl.textContent = displayUrl;
  if (captionEl) {
    // The caption is for AI suggestions only; today's single-call suggestion looks exactly as before.
    captionEl.textContent = explanationOwned ? SUGGESTION_CAPTION : '';
  }
  educationalSuggestionEl.classList.remove('hidden');
}

async function navigateToSuggestion(): Promise<void> {
  const target = currentSuggestion;
  if (!target) return;

  try {
    // Try to get the tab ID from storage or query params
    const stored = await chrome.storage.local.get(['lastRestrictedUrl']);
    const tabId = stored.lastRestrictedUrl?.tabId;

    if (tabId) {
      // Update the tab that was restricted
      await chrome.tabs.update(tabId, { url: target });
    } else {
      // Fallback: use window.location for navigation
      // Since this is an extension page, we can navigate directly
      window.location.href = target;
    }
  } catch (error) {
    console.error('Error navigating to educational resource:', error);
    // Fallback: navigate using window.location.href
    window.location.href = target;
  }
}

/**
 * Copy for the quiet-hours block, built from the current settings (this classic script cannot import
 * modules, so the hour formatting is inlined). Falls back to generic copy when the hours are unusable.
 */
async function outsideHoursReasonText(): Promise<string> {
  const isHour = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 23;
  const formatHour = (hour: number): string => String(hour).padStart(2, '0') + ':00';

  try {
    const result = await chrome.storage.local.get(['settings']);
    const allowed = result.settings?.timeLimits?.allowedHours;
    if (isHour(allowed?.start) && isHour(allowed?.end) && allowed.start !== allowed.end) {
      return `Quiet hours (${formatHour(allowed.end)}–${formatHour(allowed.start)}).\n` +
        `Browsing is not available right now. It is available again from ${formatHour(allowed.start)}.`;
    }
  } catch (error) {
    console.error('Error loading quiet hours:', error);
  }
  return 'Quiet hours.\n' +
    'Browsing is not available right now. Try again when quiet hours end.';
}
