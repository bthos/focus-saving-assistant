/**
 * Form helper utilities
 */

import type { Settings } from '../../types/index.js';
import {
  DEFAULT_CATEGORY_ITEMS,
  DEFAULT_SAFETY_LEVEL_ITEMS,
} from '../../core/classification-defaults.ts';

const SUGGESTED_URL_RULES =
  'IMPORTANT: Always provide suggestedUrl and noUrlReason. If the chosen category is Educational, set suggestedUrl to null and briefly explain in noUrlReason (e.g. \"Already educational; no alternate suggested\") — do not suggest a different educational resource.';

export const PROMPT_TEMPLATES: Record<string, string> = {
  default: `Classify if this URL/title is educational content suitable for children. URL: {url}, Title: {title}.\n\n${SUGGESTED_URL_RULES} If the content is not educational, suggest an educational alternative URL that covers similar topics or themes, or null with noUrlReason if none exists (e.g. \"No suitable educational alternative found for this type of content\" or \"Content is too specific/commercial to have an educational equivalent\"). Never leave suggestedUrl as an empty string or use placeholder text.`,
  young: `Evaluate if this site is suitable for children aged 6-10. URL: {url}, Title: {title}.\n\n${SUGGESTED_URL_RULES} If the content is not educational for this age group, suggest an age-appropriate educational alternative URL, or null with noUrlReason if none exists (e.g. \"No suitable educational alternative found for this type of content\" or \"Content is too specific/commercial to have an educational equivalent\"). Never leave suggestedUrl as an empty string or use placeholder text.`,
  teen: `Classify content by educational value for teens aged 13-16. URL: {url}, Title: {title}.\n\n${SUGGESTED_URL_RULES} If the content is not educational for teens, suggest an educational alternative URL suitable for this age group, or null with noUrlReason if none exists (e.g. \"No suitable educational alternative found for this type of content\" or \"Content is too specific/commercial to have an educational equivalent\"). Never leave suggestedUrl as an empty string or use placeholder text.`,
  strict: `Determine if this content is exclusively educational and safe for children. URL: {url}, Title: {title}.\n\n${SUGGESTED_URL_RULES} If the content is not educational, suggest a safe educational alternative URL, or null with noUrlReason if none exists (e.g. \"No suitable educational alternative found for this type of content\" or \"Content is too specific/commercial to have an educational equivalent\"). Never leave suggestedUrl as an empty string or use placeholder text.`
};

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show status message
 */
export function showStatus(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  const statusEl = document.getElementById('statusMessage');
  if (!statusEl) return;

  statusEl.textContent = message;
  statusEl.className = `status-message ${type}`;
  statusEl.style.display = 'block';

  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}

/**
 * Get default settings
 */
export function getDefaultSettings(): Settings {
  return {
    restrictedPatterns: [],
    allowedPatterns: [],
    ignoredPatterns: [],
    restrictedPageMessage: "This site has been restricted to help you stay focused.",
    aiProvider: 'github',
    aiApiToken: "",
    aiModel: "",
    aiClassificationPrompt: PROMPT_TEMPLATES.default,
    enableAIClassification: true,
    categoryItems: [...DEFAULT_CATEGORY_ITEMS],
    safetyLevelItems: [...DEFAULT_SAFETY_LEVEL_ITEMS],
    telegramBotToken: "",
    telegramChatId: "",
    enableTelegramNotifications: true,
    enableTelegramCommands: false,
    telegramPollIntervalMinutes: 1,
    notificationFrequency: "instant",
    notificationTypes: ['restricted', 'suspicious', 'weekly', 'timeLimit'],
    pageNotificationTypes: ['restricted', 'nonEducational'],
    userProfileName: "",
    timeLimits: {
      enabled: false,
      dailyLimitMinutes: 120,
      allowedHours: { start: 8, end: 22 }
    },
    parentPassword: "",
    passwordHint: "Enter word \"friend\"",
    enableSystemLogs: true
  };
}

/**
 * Render pattern list
 */
export function renderPatternList(containerId: string, patterns: string[], type: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  if (patterns.length === 0) {
    container.innerHTML = '<p class="empty-message">List is empty</p>';
    return;
  }

  patterns.forEach((pattern, index) => {
    const item = document.createElement('div');
    item.className = 'pattern-item';
    item.innerHTML = `
      <span class="pattern-text">${escapeHtml(pattern)}</span>
      <button type="button" class="btn-remove" data-index="${index}" data-type="${type}">×</button>
    `;
    container.appendChild(item);
  });
}

export type ClassificationItemType = 'category' | 'safetyLevel';

/**
 * Render classification item list (categories or safety levels) with Allow/Block toggle
 */
export function renderClassificationItemList(
  containerId: string,
  items: Array<{ name: string; restricted: boolean }>,
  itemType: ClassificationItemType
): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = '<p class="empty-message">List is empty</p>';
    return;
  }

  items.forEach((it, index) => {
    const item = document.createElement('div');
    item.className = 'pattern-item classification-item';
    const label = it.restricted ? 'Block' : 'Allow';
    item.innerHTML = `
      <span class="pattern-text">${escapeHtml(it.name)}</span>
      <label class="toggle-switch classification-toggle" title="${label}">
        <input type="checkbox" class="toggle-input" data-index="${index}" data-type="${itemType}" ${it.restricted ? 'checked' : ''} aria-label="${label}">
        <span class="toggle-slider"></span>
        <span class="toggle-label">${label}</span>
      </label>
      <button type="button" class="btn-remove" data-index="${index}" data-type="${itemType}" aria-label="Remove ${escapeHtml(it.name)}">×</button>
    `;
    container.appendChild(item);
  });
}
