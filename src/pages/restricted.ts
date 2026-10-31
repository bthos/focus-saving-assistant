/**
 * Restricted page logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Get URL from query parameters
  const urlParams = new URLSearchParams(window.location.search);
  let restrictedUrl = urlParams.get('url');
  
  // If URL not in query params, try to get from storage (fallback)
  if (!restrictedUrl || restrictedUrl.trim() === '' || restrictedUrl === 'Unknown URL') {
    try {
      const result = await chrome.storage.local.get(['lastRestrictedUrl']);
      if (result.lastRestrictedUrl?.url) {
        restrictedUrl = result.lastRestrictedUrl.url;
        // Clear the stored URL after reading it (cleanup)
        // Use setTimeout to ensure the page has time to display it
        setTimeout(() => {
          chrome.storage.local.remove(['lastRestrictedUrl']).catch(err => {
            console.error('Error clearing stored URL:', err);
          });
        }, 1000);
      }
    } catch (error) {
      console.error('Error getting URL from storage:', error);
    }
  }
  
  // Decode URL if it was encoded
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
  
  // Get and display detailed reason information
  // First try from query parameters, then from storage
  let reasonInfo: any = {
    reason: urlParams.get('reason') || null,
    category: urlParams.get('category') || null,
    safetyLevel: urlParams.get('safetyLevel') || null,
    classificationReason: urlParams.get('classificationReason') || null,
    matchedPattern: urlParams.get('matchedPattern') || null
  };
  
  // If no info in query params, try storage
  if (!reasonInfo.reason) {
    try {
      const storedResult = await chrome.storage.local.get(['lastRestrictedUrl']);
      if (storedResult.lastRestrictedUrl) {
        reasonInfo = {
          reason: storedResult.lastRestrictedUrl.reason || reasonInfo.reason,
          category: storedResult.lastRestrictedUrl.category || reasonInfo.category,
          safetyLevel: storedResult.lastRestrictedUrl.safetyLevel || reasonInfo.safetyLevel,
          classificationReason: storedResult.lastRestrictedUrl.classificationReason || reasonInfo.classificationReason,
          matchedPattern: storedResult.lastRestrictedUrl.matchedPattern || reasonInfo.matchedPattern,
          reasonDetails: storedResult.lastRestrictedUrl.reasonDetails || null
        };
      }
    } catch (error) {
      console.error('Error getting reason info from storage:', error);
    }
  }
  
  // Display detailed reason
  const reasonInfoEl = document.getElementById('reasonInfo');
  const reasonDetailsEl = document.getElementById('reasonDetails');
  
  if (reasonInfo.reason && reasonInfoEl && reasonDetailsEl) {
    let reasonText = '';
    
    if (reasonInfo.reason === 'content-restricted') {
      reasonText = 'Content blocked based on classification:';
      if (reasonInfo.reasonDetails && Array.isArray(reasonInfo.reasonDetails)) {
        reasonText += '\n' + reasonInfo.reasonDetails.join('\n');
      } else {
        // Build from individual fields
        const details: string[] = [];
        if (reasonInfo.category) {
          details.push(`Category: ${reasonInfo.category}`);
        }
        if (reasonInfo.safetyLevel) {
          details.push(`Safety Level: ${reasonInfo.safetyLevel}`);
        }
        if (reasonInfo.classificationReason) {
          details.push(`Reason: ${reasonInfo.classificationReason}`);
        }
        if (details.length > 0) {
          reasonText += '\n' + details.join('\n');
        } else {
          reasonText += '\nSite does not meet the established restrictions for category or safety level';
        }
      }
    } else if (reasonInfo.reason === 'restricted') {
      reasonText = 'Site is in the restricted list';
      if (reasonInfo.matchedPattern) {
        reasonText += `\nMatches rule: ${reasonInfo.matchedPattern}`;
      }
    } else {
      reasonText = `Reason: ${reasonInfo.reason || 'Unknown'}`;
      if (reasonInfo.matchedPattern) {
        reasonText += `\nMatches rule: ${reasonInfo.matchedPattern}`;
      }
    }
    
    reasonDetailsEl.textContent = reasonText;
    reasonInfoEl.classList.remove('hidden');
  }
  
  // Get suggested educational resource URL
  // First try from query parameters, then from storage
  let suggestedEducationalUrl: string | null = urlParams.get('suggestedUrl');
  if (!suggestedEducationalUrl) {
    try {
      const storedResult = await chrome.storage.local.get(['lastRestrictedUrl']);
      if (storedResult.lastRestrictedUrl?.suggestedUrl) {
        suggestedEducationalUrl = storedResult.lastRestrictedUrl.suggestedUrl;
      }
    } catch (error) {
      console.error('Error getting suggested URL from storage:', error);
    }
  }
  
  // Display educational suggestion if available
  const educationalSuggestionEl = document.getElementById('educationalSuggestion');
  const suggestedUrlEl = document.getElementById('suggestedUrl');
  const goToEducationalBtn = document.getElementById('goToEducationalBtn');
  
  if (suggestedEducationalUrl && educationalSuggestionEl && suggestedUrlEl && goToEducationalBtn) {
    // Decode URL if needed
    let displayUrl = suggestedEducationalUrl;
    try {
      displayUrl = decodeURIComponent(suggestedEducationalUrl);
    } catch (e) {
      // Use as-is if decoding fails
    }
    
    suggestedUrlEl.textContent = displayUrl;
    educationalSuggestionEl.classList.remove('hidden');
    
    // Handle click on "Go to educational resource" button
    goToEducationalBtn.addEventListener('click', async () => {
      if (!suggestedEducationalUrl) return;
      
      try {
        // Try to get the tab ID from storage or query params
        const stored = await chrome.storage.local.get(['lastRestrictedUrl']);
        const tabId = stored.lastRestrictedUrl?.tabId;
        
        if (tabId) {
          // Update the tab that was restricted
          await chrome.tabs.update(tabId, { url: suggestedEducationalUrl });
        } else {
          // Fallback: use window.location for navigation
          // Since this is an extension page, we can navigate directly
          window.location.href = suggestedEducationalUrl;
        }
      } catch (error) {
        console.error('Error navigating to educational resource:', error);
        // Fallback: navigate using window.location.href
        window.location.href = suggestedEducationalUrl;
      }
    });
  }
  
  // Load settings to get message
  // Note: Using direct storage key since we can't import modules in this context
  try {
    const result = await chrome.storage.local.get(['settings']);
    const settings = result.settings as any;
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
