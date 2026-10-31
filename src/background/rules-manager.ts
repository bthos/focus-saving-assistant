/**
 * Manages declarativeNetRequest rules for URL blocking
 */

import type { Settings } from '../types';
import { RESTRICTED_PAGE_PATH } from '../utils/constants.js';
import { addSystemLog } from '../utils/system-logger';

let ruleIdCounter = 1;

/**
 * Convert pattern to regex filter for declarativeNetRequest
 */
function patternToRegexFilter(pattern: string): string {
  // Handle *.example.com -> match all subdomains
  if (pattern.startsWith('*.')) {
    const domain = pattern.substring(2);
    return `^https?://([a-zA-Z0-9-]+\\.)*${domain.replace(/\./g, '\\.')}(/.*)?$`;
  }
  // Handle example.com/* -> match all paths on domain
  if (pattern.endsWith('/*')) {
    const domain = pattern.slice(0, -2);
    return `^https?://([a-zA-Z0-9-]+\\.)*${domain.replace(/\./g, '\\.')}/.*$`;
  }
  // Handle other wildcard patterns
  const regexPattern = pattern
    .replace(/\./g, '\\.')
    .replace(/\*/g, '.*');
  return `^https?://.*${regexPattern}.*$`;
}

/**
 * Convert pattern to urlFilter format for declarativeNetRequest
 */
function patternToUrlFilter(pattern: string): string {
  // For simple domain patterns like "google.com", convert to match all URLs with that domain
  // Use || prefix to match domain and all subdomains: ||google.com matches google.com and all subdomains
  if (!pattern.includes('/') && !pattern.includes('://')) {
    return `||${pattern}`;
  }
  return pattern;
}

/**
 * Load restriction rules into declarativeNetRequest
 */
export async function loadRestrictionRules(): Promise<void> {
  const result = await chrome.storage.local.get(['settings']);
  const settings = result.settings as Settings || {} as Settings;
  const restrictedPatterns = settings.restrictedPatterns || [];

  console.log('Loading restriction rules for patterns:', restrictedPatterns);

  const rules = restrictedPatterns.map((pattern: string) => {
    // If pattern contains *, need to use regexFilter instead of urlFilter
    if (pattern.includes('*')) {
      const regexPattern = patternToRegexFilter(pattern);
      console.log(`Creating regex rule for pattern "${pattern}": ${regexPattern}`);

      return {
        id: ruleIdCounter++,
        priority: 1,
        action: {
          type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
          redirect: {
            extensionPath: RESTRICTED_PAGE_PATH
          }
        },
        condition: {
          regexFilter: regexPattern,
          resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType]
        }
      };
    }

    // For simple domain patterns, use urlFilter
    const urlFilter = patternToUrlFilter(pattern);
    console.log(`Converting domain pattern "${pattern}" to urlFilter: "${urlFilter}"`);

    return {
      id: ruleIdCounter++,
      priority: 1,
      action: {
        type: 'redirect' as chrome.declarativeNetRequest.RuleActionType,
        redirect: {
          extensionPath: RESTRICTED_PAGE_PATH
        }
      },
      condition: {
        urlFilter: urlFilter,
        resourceTypes: ['main_frame' as chrome.declarativeNetRequest.ResourceType]
      }
    };
  });

  try {
    // Remove old rules
    const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleIds = existingRules.map(rule => rule.id);
    if (ruleIds.length > 0) {
      console.log(`Removing ${ruleIds.length} old rules`);
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ruleIds
      });
    }

    // Add new rules
    if (rules.length > 0) {
      console.log(`Adding ${rules.length} new restriction rules:`, rules);
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: rules
      });
      console.log('Restriction rules loaded successfully');
    } else {
      console.log('No restriction rules to add');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error loading restriction rules:', errorMessage);
    await addSystemLog('system', `Failed to load restriction rules: ${errorMessage}`);
  }
}
