/**
 * Content script overlay for restricted pages
 * Based on StayFocusd approach - shows overlay on restricted pages
 */

interface RestrictionInfo {
  url: string;
  reason: string;
  message?: string;
}

/**
 * Create and inject restriction overlay
 */
function createRestrictionOverlay(info: RestrictionInfo): void {
  // Remove existing overlay if present
  const existingOverlay = document.getElementById('focus-saving-restriction-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  // Create overlay container
  const overlay = document.createElement('div');
  overlay.id = 'focus-saving-restriction-overlay';
  overlay.className = 'focus-saving-overlay';

  // Create content container
  const content = document.createElement('div');
  content.className = 'focus-saving-overlay-content';

  // Create icon
  const icon = document.createElement('div');
  icon.className = 'focus-saving-overlay-icon';
  icon.textContent = '🚫';
  content.appendChild(icon);

  // Create title
  const title = document.createElement('h1');
  title.className = 'focus-saving-overlay-title';
  title.textContent = 'Access Restricted';
  content.appendChild(title);

  // Create message
  const message = document.createElement('div');
  message.className = 'focus-saving-overlay-message';
  message.textContent = info.message || 'This site has been restricted to help you stay focused.';
  content.appendChild(message);

  // Create URL info
  const urlInfo = document.createElement('div');
  urlInfo.className = 'focus-saving-overlay-url';
  const displayUrl = info.url && info.url !== 'Unknown URL' ? info.url : 
                     (window.location.href || document.URL || 'Unknown URL');
  urlInfo.innerHTML = `<strong>Restricted URL:</strong><br><span class="url-text">${escapeHtmlForOverlay(displayUrl)}</span>`;
  content.appendChild(urlInfo);

  // Create reason info if available
  if (info.reason) {
    const reasonInfo = document.createElement('div');
    reasonInfo.className = 'focus-saving-overlay-reason';
    reasonInfo.innerHTML = `<strong>Reason:</strong> ${escapeHtmlForOverlay(info.reason)}`;
    content.appendChild(reasonInfo);
  }

  // Create actions container
  const actions = document.createElement('div');
  actions.className = 'focus-saving-overlay-actions';

  // Go back button
  const goBackBtn = document.createElement('button');
  goBackBtn.className = 'focus-saving-btn focus-saving-btn-primary';
  goBackBtn.textContent = 'Go Back';
  goBackBtn.addEventListener('click', () => {
    window.history.back();
  });
  actions.appendChild(goBackBtn);

  content.appendChild(actions);

  // Create footer
  const footer = document.createElement('div');
  footer.className = 'focus-saving-overlay-footer';
  footer.textContent = 'If you believe this is an error, please check your settings.';
  content.appendChild(footer);

  overlay.appendChild(content);
  document.body.appendChild(overlay);

  // Prevent interaction with page content
  preventPageInteraction();
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtmlForOverlay(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Prevent interaction with page content when restricted
 */
function preventPageInteraction(): void {
  // Disable all links
  const links = document.querySelectorAll('a');
  links.forEach(link => {
    link.style.pointerEvents = 'none';
    link.style.cursor = 'not-allowed';
  });

  // Disable all buttons
  const buttons = document.querySelectorAll('button');
  buttons.forEach(button => {
    if (!button.closest('#focus-saving-restriction-overlay')) {
      button.disabled = true;
    }
  });

  // Disable all inputs
  const inputs = document.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    if (!input.closest('#focus-saving-restriction-overlay')) {
      (input as HTMLElement).style.pointerEvents = 'none';
    }
  });

  // Prevent scrolling
  document.body.style.overflow = 'hidden';
}

/**
 * Remove restriction overlay
 */
function removeRestrictionOverlay(): void {
  const overlay = document.getElementById('focus-saving-restriction-overlay');
  if (overlay) {
    overlay.remove();
  }

  // Restore page interaction
  document.body.style.overflow = '';
  const links = document.querySelectorAll('a');
  links.forEach(link => {
    link.style.pointerEvents = '';
    link.style.cursor = '';
  });
  const buttons = document.querySelectorAll('button');
  buttons.forEach(button => {
    button.disabled = false;
  });
  const inputs = document.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    (input as HTMLElement).style.pointerEvents = '';
  });
}

/** Content scripts should have `storage` permission, but guard if API is missing (e.g. invalidated context). */
function isStorageAvailable(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

async function getSettingsFromStorage(): Promise<Record<string, unknown> | null> {
  if (!isStorageAvailable()) {
    return null;
  }
  try {
    const settingsResult = await chrome.storage.local.get(['settings']);
    return (settingsResult.settings as Record<string, unknown>) ?? null;
  } catch {
    return null;
  }
}

function restrictedPageMessageFromSettings(settings: Record<string, unknown> | null): string {
  const raw = settings?.restrictedPageMessage;
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim();
  }
  return 'This site has been restricted to help you stay focused.';
}

/**
 * Check if current page should be restricted
 */
async function checkIfRestricted(): Promise<RestrictionInfo | null> {
  try {
    // Get current URL with fallbacks
    const currentUrl = window.location.href || 
                      window.location.toString() || 
                      document.URL || 
                      (document.location && document.location.href) ||
                      'Unknown URL';
    
    // Ensure we have a valid URL
    if (!currentUrl || currentUrl === 'about:blank' || currentUrl === 'about:srcdoc') {
      // Try to get URL from document referrer or other sources
      const fallbackUrl = document.referrer || 'Unknown URL';
      console.warn('Could not determine current URL, using fallback:', fallbackUrl);
    }
    
    // Try to check with background script first
    let response: any = null;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'checkRestricted',
        url: currentUrl
      });
    } catch (messageError: any) {
      // If service worker is not available, fallback to direct storage check
      const errorMessage = messageError?.message || String(messageError);
      if (errorMessage.includes('Could not establish connection') || 
          errorMessage.includes('Receiving end does not exist') ||
          errorMessage.includes('Extension context invalidated')) {
        console.warn('Service worker unavailable, using fallback check:', errorMessage);
        // Fallback: check directly via storage
        response = await checkRestrictedFallback(currentUrl);
      } else {
        // Re-throw other errors
        throw messageError;
      }
    }

    if (response && response.restricted) {
      // Get settings for custom message
      const settings = await getSettingsFromStorage();
      const message = restrictedPageMessageFromSettings(settings);

      return {
        url: currentUrl || 'Unknown URL',
        reason: response.reason === 'outside-hours'
          ? 'Quiet hours'
          : response.reason || 'Restricted by focus saving',
        message,
      };
    }
  } catch (error) {
    console.error('Error checking if restricted:', error);
    // Try fallback check on any error
    try {
      const currentUrl = window.location.href || document.URL || 'Unknown URL';
      const fallbackResponse = await checkRestrictedFallback(currentUrl);
      if (fallbackResponse && fallbackResponse.restricted) {
        const settings = await getSettingsFromStorage();
        const message = restrictedPageMessageFromSettings(settings);
        return {
          url: currentUrl,
          reason: fallbackResponse.reason || 'Restricted by focus saving',
          message,
        };
      }
    } catch (fallbackError) {
      console.error('Fallback check also failed:', fallbackError);
    }
  }

  return null;
}

/**
 * Fallback check when service worker is unavailable
 * Checks restrictions directly via storage
 */
async function checkRestrictedFallback(url: string): Promise<{ restricted: boolean; reason?: string } | null> {
  try {
    if (!isStorageAvailable()) {
      console.warn('restriction-overlay: chrome.storage.local unavailable, skip fallback');
      return null;
    }

    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings;
    
    if (!settings) {
      return { restricted: false };
    }
    
    // Check allowed list first
    if (settings.allowedPatterns && Array.isArray(settings.allowedPatterns)) {
      for (const pattern of settings.allowedPatterns) {
        if (matchesPatternSimple(url, pattern)) {
          return { restricted: false };
        }
      }
    }
    
    // Check restricted patterns
    if (settings.restrictedPatterns && Array.isArray(settings.restrictedPatterns)) {
      for (const pattern of settings.restrictedPatterns) {
        if (matchesPatternSimple(url, pattern)) {
          return { 
            restricted: true, 
            reason: `restricted (pattern: ${pattern})` 
          };
        }
      }
    }
    
    return { restricted: false };
  } catch (error) {
    console.error('Error in fallback check:', error);
    return null;
  }
}

/**
 * Simple pattern matching for fallback check
 * Simplified version for content script context (can't import modules)
 */
function matchesPatternSimple(url: string, pattern: string): boolean {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;

    // Exact match
    if (pattern === hostname || pattern === url) {
      return true;
    }

    // Subdomain pattern (*.example.com)
    if (pattern.startsWith('*.')) {
      const domain = pattern.substring(2);
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return true;
      }
    }

    // Path pattern (example.com/*)
    if (pattern.endsWith('/*')) {
      const domain = pattern.slice(0, -2);
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        return true;
      }
    }

    // Simple substring match
    if (hostname.includes(pattern) || url.includes(pattern)) {
      return true;
    }

    return false;
  } catch (e) {
    // If URL parsing fails, try simple string match
    return url.includes(pattern);
  }
}

/**
 * Initialize restriction overlay
 */
async function initRestrictionOverlay(): Promise<void> {
  // Wait for page to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
      const restrictionInfo = await checkIfRestricted();
      if (restrictionInfo) {
        createRestrictionOverlay(restrictionInfo);
      }
    });
  } else {
    const restrictionInfo = await checkIfRestricted();
    if (restrictionInfo) {
      createRestrictionOverlay(restrictionInfo);
    }
  }

  // Listen for navigation changes (for SPAs)
  let lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
      lastUrl = url;
      // Check again after navigation
      setTimeout(async () => {
        removeRestrictionOverlay();
        const restrictionInfo = await checkIfRestricted();
        if (restrictionInfo) {
          createRestrictionOverlay(restrictionInfo);
        }
      }, 100);
    }
  }).observe(document, { subtree: true, childList: true });
}

// Initialize when script loads
initRestrictionOverlay();

// Export for potential use in other scripts
if (typeof window !== 'undefined') {
  (window as any).focusSavingOverlay = {
    create: createRestrictionOverlay,
    remove: removeRestrictionOverlay,
    check: checkIfRestricted
  };
}
