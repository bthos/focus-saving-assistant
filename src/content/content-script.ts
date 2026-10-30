/**
 * Content Script for extracting page metadata
 */

interface PageMetadata {
  title: string;
  description: string;
  keywords: string;
  ogTitle: string;
  ogDescription: string;
}

// Extract page metadata and send to background script
(function() {
  'use strict';
  
  function extractPageMetadata(): PageMetadata {
    const metadata: PageMetadata = {
      title: document.title || '',
      description: '',
      keywords: '',
      ogTitle: '',
      ogDescription: ''
    };
    
    // Standard meta tags
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metadata.description = metaDescription.getAttribute('content') || '';
    }
    
    const metaKeywords = document.querySelector('meta[name="keywords"]');
    if (metaKeywords) {
      metadata.keywords = metaKeywords.getAttribute('content') || '';
    }
    
    // Open Graph tags
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) {
      metadata.ogTitle = ogTitle.getAttribute('content') || '';
    }
    
    const ogDescription = document.querySelector('meta[property="og:description"]');
    if (ogDescription) {
      metadata.ogDescription = ogDescription.getAttribute('content') || '';
    }
    
    return metadata;
  }
  
  // Send metadata to background script after page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const metadata = extractPageMetadata();
      chrome.runtime.sendMessage({
        type: 'pageMetadata',
        url: window.location.href,
        metadata: metadata
      }).catch(() => {
        // Ignore errors (e.g., if background script is not ready)
      });
    });
  } else {
    const metadata = extractPageMetadata();
    chrome.runtime.sendMessage({
      type: 'pageMetadata',
      url: window.location.href,
      metadata: metadata
    }).catch(() => {
      // Ignore errors
    });
  }
})();
