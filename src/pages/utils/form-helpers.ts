/**
 * Form helper utilities
 */

import type { ClassificationItem, Settings } from '../../types/index.js';
import { DEFAULT_SETTINGS } from '../../core/default-settings.ts';
import {
  getClassificationLimitWarnings,
  MAX_CATEGORY_ITEMS,
  MAX_SAFETY_LEVEL_ITEMS,
  type ItemKind,
} from '../../core/classification-limits.ts';
import { getBuiltInItemDescription } from '../../core/decision-request.ts';

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
 * Get default settings (a deep copy of DEFAULT_SETTINGS, so callers may mutate it)
 */
export function getDefaultSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
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

const LIST_UI: Record<ClassificationItemType, {
  kind: ItemKind;
  max: number;
  noun: string;
  countHintId: string;
  warningId: string;
}> = {
  category: { kind: 'category', max: MAX_CATEGORY_ITEMS, noun: 'categories', countHintId: 'categoryCountHint', warningId: 'categoryLimitWarning' },
  safetyLevel: { kind: 'safety', max: MAX_SAFETY_LEVEL_ITEMS, noun: 'safety levels', countHintId: 'safetyCountHint', warningId: 'safetyLimitWarning' },
};

/**
 * Counter ("23 of 40 categories") and the non-blocking over-limit warning below a list.
 */
function updateClassificationLimitHints(items: ClassificationItem[], itemType: ClassificationItemType): void {
  const ui = LIST_UI[itemType];
  const countEl = document.getElementById(ui.countHintId);
  if (countEl) {
    countEl.textContent = `${items.length} of ${ui.max} ${ui.noun}`;
  }
  const warningEl = document.getElementById(ui.warningId);
  if (warningEl) {
    const warnings = getClassificationLimitWarnings(items, ui.kind);
    warningEl.textContent = warnings.join(' ');
    warningEl.classList.toggle('hidden', warnings.length === 0);
  }
}

/**
 * Render classification item list (categories or safety levels) with Allow/Block toggle
 * and an optional description for the decision model
 */
export function renderClassificationItemList(
  containerId: string,
  items: ClassificationItem[],
  itemType: ClassificationItemType
): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';
  updateClassificationLimitHints(items, itemType);

  if (items.length === 0) {
    container.innerHTML = '<p class="empty-message">List is empty</p>' +
      '<p class="help-text">No items: the decision model uses the built-in list and nothing here is blocked.</p>';
    return;
  }

  const { kind, noun } = LIST_UI[itemType];
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

    // Properties, not markup: the item name and description are user text.
    const description = document.createElement('input');
    description.type = 'text';
    description.className = 'input classification-description';
    description.dataset.index = String(index);
    description.dataset.type = itemType;
    description.maxLength = 200;
    description.value = it.description ?? '';
    description.placeholder = getBuiltInItemDescription(it.name, kind) ??
      `Optional: how does this differ from the other ${noun}?`;
    description.title = description.placeholder;
    description.setAttribute('aria-label', `Description for ${it.name} (optional)`);
    item.appendChild(description);

    container.appendChild(item);
  });
}
