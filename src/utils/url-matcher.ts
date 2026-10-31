/**
 * Utilities for checking URLs against restriction rules
 */

import { Settings, UrlCheckResult, ClassificationResult } from '../types';
import { matchesPattern } from '../core/pattern-matcher.ts';
import { matchesContentRestrictions } from '../core/content-restrictions.ts';
import { getCachedClassification } from './storage';

/**
 * Checks if URL is in allowed list
 */
export function isAllowed(url: string, allowedPatterns: string[]): boolean {
  if (!allowedPatterns || allowedPatterns.length === 0) {
    return false;
  }
  
  return allowedPatterns.some(pattern => matchesPattern(url, pattern));
}

/**
 * Checks if URL is restricted
 */
export function isRestricted(url: string, restrictedPatterns: string[]): boolean {
  if (!restrictedPatterns || restrictedPatterns.length === 0) {
    return false;
  }
  
  return restrictedPatterns.some(pattern => matchesPattern(url, pattern));
}

/**
 * Checks if URL is in ignored list (should skip AI classification)
 */
export function isIgnored(url: string, ignoredPatterns: string[]): boolean {
  if (!ignoredPatterns || ignoredPatterns.length === 0) {
    return false;
  }
  
  return ignoredPatterns.some(pattern => matchesPattern(url, pattern));
}

/**
 * Checks URL against restriction rules and allowed list
 * Returns an object with the check result
 */
export async function checkUrl(url: string, settings: Settings, classification?: ClassificationResult | null): Promise<UrlCheckResult> {
  // First check allowed list (has priority)
  if (isAllowed(url, settings.allowedPatterns)) {
    return {
      restricted: false,
      reason: 'allowed',
      matchedPattern: null
    };
  }
  
  // Then check restricted list
  if (isRestricted(url, settings.restrictedPatterns)) {
    const matchedPattern = settings.restrictedPatterns.find(pattern => 
      matchesPattern(url, pattern)
    );
    return {
      restricted: true,
      reason: 'restricted',
      matchedPattern: matchedPattern || null
    };
  }
  
  // Check Content Restrictions using classification (from cache if available)
  if (settings.enableAIClassification && 
      ((settings.restrictedCategories?.length ?? 0) > 0 || (settings.restrictedSafetyLevels?.length ?? 0) > 0)) {
    
    // Use provided classification or try to get from cache
    let classificationToCheck = classification;
    if (!classificationToCheck) {
      classificationToCheck = await getCachedClassification(url);
    }
    
    if (matchesContentRestrictions(
      classificationToCheck,
      settings.restrictedCategories || [],
      settings.restrictedSafetyLevels || []
    )) {
      return {
        restricted: true,
        reason: 'content-restricted',
        matchedPattern: null
      };
    }
  }
  
  return {
    restricted: false,
    reason: 'permitted',
    matchedPattern: null
  };
}
