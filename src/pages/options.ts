/**
 * Settings page logic
 */

import type { ClassificationItem, Settings } from '../types/index.js';
import { STORAGE_KEYS } from '../utils/constants.js';
import { formatHour } from '../core/quiet-hours.ts';
import { deriveAudience, normalizeSettingsShape } from '../core/settings-migration.ts';
import {
  getClassificationLimitWarnings,
  MAX_CATEGORY_ITEMS,
  MAX_SAFETY_LEVEL_ITEMS,
  sanitizeItemDescription,
  validateNewItem,
  type ItemKind,
} from '../core/classification-limits.ts';
import { getSettings as getStoredSettings } from '../utils/storage.js';
import { initPasswordGate } from './utils/password-gate.js';
import { whenDocumentReady } from './utils/document-ready.js';
import { showPageLoadErrorInMain } from './utils/page-load-error.js';
import { getDefaultSettings, renderPatternList, renderClassificationItemList, showStatus } from './utils/form-helpers.js';
import { loadAvailableModels } from './utils/ai-models-handler.js';
import { commitAudienceField, populateAiTab, readAiTabValues, setupAiTabListeners, validateAiTab } from './utils/ai-tab.js';
import { loadTelegramGroups, testTelegram } from './utils/telegram-handler.js';

let currentSettings: Settings;
let aiTabPopulated = false;

const initOptionsPage = async () => {
  try {
    await initPasswordGate(async () => {
      await loadSettings();
      setupEventListeners();
      setupTabs();
    });
  } catch (error) {
    console.error('Error initializing options page:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    showPageLoadErrorInMain('Error Loading Settings', error);
  }
};

whenDocumentReady(() => {
  void initOptionsPage();
});

async function loadSettings(): Promise<void> {
  try {
    currentSettings = await getStoredSettings();
    populateForm(currentSettings);

    try {
      const result = await chrome.storage.local.get([STORAGE_KEYS.LAST_AI_ERROR]);
      if (result[STORAGE_KEYS.LAST_AI_ERROR]) {
        displayAIError(result[STORAGE_KEYS.LAST_AI_ERROR] as string);
      }
    } catch (aiErr) {
      console.warn('Options: could not read or show last AI error', aiErr);
    }
  } catch (error) {
    showStatus('Error loading settings: ' + (error instanceof Error ? error.message : String(error)), 'error');
    throw error;
  }
}

function populateForm(settings: Settings): void {
  // Restriction
  renderPatternList('restrictedPatternsList', settings.restrictedPatterns || [], 'restricted');
  renderPatternList('allowedPatternsList', settings.allowedPatterns || [], 'allowed');
  renderPatternList('ignoredPatternsList', settings.ignoredPatterns || [], 'ignored');
  const restrictedMsgEl = document.getElementById('restrictedPageMessage') as HTMLTextAreaElement;
  if (restrictedMsgEl) restrictedMsgEl.value = settings.restrictedPageMessage || '';
  
  // AI
  const aiProviderEl = document.getElementById('aiProvider') as HTMLSelectElement;
  if (aiProviderEl) {
    aiProviderEl.value = settings.aiProvider || 'github';
    updateProviderHelpText(settings.aiProvider || 'github');
  }
  const aiTokenEl = document.getElementById('aiApiToken') as HTMLInputElement;
  if (aiTokenEl) aiTokenEl.value = settings.aiApiToken || '';
  const aiModelEl = document.getElementById('aiModel') as HTMLSelectElement;
  if (aiModelEl) {
    const savedModel = settings.aiModel || '';
    if (savedModel) {
      // Check if the saved model exists in the select options
      const modelExists = Array.from(aiModelEl.options).some(opt => opt.value === savedModel);
      if (!modelExists) {
        // Add the saved model as an option if it doesn't exist
        const option = document.createElement('option');
        option.value = savedModel;
        option.textContent = savedModel;
        aiModelEl.appendChild(option);
      }
    }
    aiModelEl.value = savedModel;
  }
  const aiEnableEl = document.getElementById('enableAIClassification') as HTMLInputElement;
  if (aiEnableEl) aiEnableEl.checked = settings.enableAIClassification !== false;
  // Decision model, explanation model, audience, prompts, mode line (the single-call prompt opens only on first load)
  populateAiTab(settings, { initial: !aiTabPopulated });
  aiTabPopulated = true;
  
  // Content restrictions: categories and risk levels (list + Allow/Block toggle)
  const categoryItems = settings.categoryItems ?? [];
  const safetyLevelItems = settings.safetyLevelItems ?? [];
  renderClassificationItemList('categoryItemsList', categoryItems, 'category');
  renderClassificationItemList('safetyLevelItemsList', safetyLevelItems, 'safetyLevel');
  
  // Update AI classification dependent fields state
  updateAIClassificationDependentFields();
  
  // Telegram
  const tgEnableEl = document.getElementById('enableTelegramNotifications') as HTMLInputElement;
  if (tgEnableEl) tgEnableEl.checked = settings.enableTelegramNotifications !== false;
  const tgTokenEl = document.getElementById('telegramBotToken') as HTMLInputElement;
  if (tgTokenEl) tgTokenEl.value = settings.telegramBotToken || '';
  const tgChatEl = document.getElementById('telegramChatId') as HTMLSelectElement;
  const tgChatManualEl = document.getElementById('telegramChatIdManual') as HTMLInputElement;
  if (tgChatEl && tgChatManualEl) {
    // If chat ID exists, try to set it in manual input or select
    const chatId = settings.telegramChatId || '';
    if (chatId) {
      tgChatManualEl.value = chatId;
      // Try to find matching option in select
      const option = Array.from(tgChatEl.options).find(opt => opt.value === chatId);
      if (option) {
        tgChatEl.value = chatId;
      }
    }
  }
  const tgFreqEl = document.getElementById('notificationFrequency') as HTMLSelectElement;
  if (tgFreqEl) tgFreqEl.value = settings.notificationFrequency || 'instant';
  const tgCommandsEl = document.getElementById('enableTelegramCommands') as HTMLInputElement;
  if (tgCommandsEl) tgCommandsEl.checked = settings.enableTelegramCommands === true;
  const tgPollIntervalEl = document.getElementById('telegramPollInterval') as HTMLSelectElement;
  if (tgPollIntervalEl) {
    const interval = settings.telegramPollIntervalMinutes ?? 1;
    tgPollIntervalEl.value = String(interval);
  }
  updateTelegramCommandsDependentFields();
  
  // Quiet hours (settings are normalised: integer hours 0..23). The form shows the quiet window;
  // storage keeps the complementary allowed window: quiet from = allowedHours.end, until = allowedHours.start.
  const quietEnabledEl = document.getElementById('timeLimitsEnabled') as HTMLInputElement;
  if (quietEnabledEl) quietEnabledEl.checked = settings.timeLimits.enabled;
  const quietFromEl = document.getElementById('quietHoursFrom') as HTMLSelectElement;
  if (quietFromEl) quietFromEl.value = String(settings.timeLimits.allowedHours.end);
  const quietUntilEl = document.getElementById('quietHoursUntil') as HTMLSelectElement;
  if (quietUntilEl) quietUntilEl.value = String(settings.timeLimits.allowedHours.start);
  updateQuietHoursDependentFields();

  // Notification types
  const notificationTypes = settings.notificationTypes || ['restricted', 'suspicious', 'weekly', 'timeLimit'];
  const restrictedTypeEl = document.getElementById('notificationTypeRestricted') as HTMLInputElement;
  if (restrictedTypeEl) restrictedTypeEl.checked = notificationTypes.includes('restricted');
  const suspiciousTypeEl = document.getElementById('notificationTypeSuspicious') as HTMLInputElement;
  if (suspiciousTypeEl) suspiciousTypeEl.checked = notificationTypes.includes('suspicious');
  const weeklyTypeEl = document.getElementById('notificationTypeWeekly') as HTMLInputElement;
  if (weeklyTypeEl) weeklyTypeEl.checked = notificationTypes.includes('weekly');
  const timeLimitTypeEl = document.getElementById('notificationTypeTimeLimit') as HTMLInputElement;
  if (timeLimitTypeEl) timeLimitTypeEl.checked = notificationTypes.includes('timeLimit');
  
  // Page notification types
  const pageNotificationTypes = settings.pageNotificationTypes || ['restricted', 'nonEducational'];
  const pageRestrictedTypeEl = document.getElementById('pageNotificationTypeRestricted') as HTMLInputElement;
  if (pageRestrictedTypeEl) pageRestrictedTypeEl.checked = pageNotificationTypes.includes('restricted');
  const pageAllowedTypeEl = document.getElementById('pageNotificationTypeAllowed') as HTMLInputElement;
  if (pageAllowedTypeEl) pageAllowedTypeEl.checked = pageNotificationTypes.includes('allowed');
  const pageEducationalTypeEl = document.getElementById('pageNotificationTypeEducational') as HTMLInputElement;
  if (pageEducationalTypeEl) pageEducationalTypeEl.checked = pageNotificationTypes.includes('educational');
  const pageNonEducationalTypeEl = document.getElementById('pageNotificationTypeNonEducational') as HTMLInputElement;
  if (pageNonEducationalTypeEl) pageNonEducationalTypeEl.checked = pageNotificationTypes.includes('nonEducational');
  
  // General
  const userNameEl = document.getElementById('userProfileName') as HTMLInputElement;
  if (userNameEl) userNameEl.value = settings.userProfileName || '';
  const pwdEl = document.getElementById('parentPassword') as HTMLInputElement;
  if (pwdEl) pwdEl.value = settings.parentPassword || '';
  const hintEl = document.getElementById('passwordHint') as HTMLInputElement;
  if (hintEl) hintEl.value = settings.passwordHint || 'Enter word "friend"';
  const enableSystemLogsEl = document.getElementById('enableSystemLogs') as HTMLInputElement;
  if (enableSystemLogsEl) enableSystemLogsEl.checked = settings.enableSystemLogs !== false; // Default to true
  
  // Try to auto-detect user name on load if not set
  if (!settings.userProfileName) {
    detectUserName();
  }
}

function updateAIClassificationDependentFields(): void {
  const aiEnableEl = document.getElementById('enableAIClassification') as HTMLInputElement;
  const contentGroup = document.getElementById('contentRestrictionsGroup');
  const safetyGroup = document.getElementById('safetyLevelsGroup');
  const warningEl = document.getElementById('aiClassificationWarning');

  const isEnabled = aiEnableEl?.checked === true;

  if (contentGroup) contentGroup.style.opacity = isEnabled ? '1' : '0.5';
  if (contentGroup) contentGroup.style.pointerEvents = isEnabled ? 'auto' : 'none';
  if (safetyGroup) safetyGroup.style.opacity = isEnabled ? '1' : '0.5';
  if (safetyGroup) safetyGroup.style.pointerEvents = isEnabled ? 'auto' : 'none';
  if (warningEl) {
    if (isEnabled) {
      warningEl.classList.add('hidden');
    } else {
      warningEl.classList.remove('hidden');
    }
  }
}

const TELEGRAM_POLL_HELP_TEXTS: Record<string, string> = {
  '0.5': '30 sec: Commands processed within ~30 sec; ~120 API requests/hour.',
  '1': '1 min: Balance of speed and load; ~60 API requests/hour.',
  '2': '2 min: Delay up to 2 min; ~30 API requests/hour.',
  '5': '5 min: Delay up to 5 min; ~12 API requests/hour.',
};

function updateTelegramCommandsDependentFields(): void {
  const tgCommandsEl = document.getElementById('enableTelegramCommands') as HTMLInputElement;
  const pollGroupEl = document.getElementById('telegramPollIntervalGroup');
  const pollHelpEl = document.getElementById('telegramPollIntervalHelp');
  const pollIntervalEl = document.getElementById('telegramPollInterval') as HTMLSelectElement;

  const isEnabled = tgCommandsEl?.checked === true;
  if (pollGroupEl) {
    pollGroupEl.style.display = isEnabled ? '' : 'none';
  }
  if (pollHelpEl && pollIntervalEl) {
    const baseHelp =
      'How often the extension checks for new commands. ' +
      'Too long — browser may close before the command is received; too short — excessive API requests. ';
    const intervalHelp = TELEGRAM_POLL_HELP_TEXTS[pollIntervalEl.value] || '';
    pollHelpEl.textContent =
      baseHelp + intervalHelp + ' Polling works only while Chrome is running.';
  }
}

/**
 * Quiet hours: selects are disabled while the toggle is off; the summary states the quiet window
 * (the first select is where it starts, the second where it ends).
 */
function updateQuietHoursDependentFields(): void {
  const enabledEl = document.getElementById('timeLimitsEnabled') as HTMLInputElement | null;
  const fromEl = document.getElementById('quietHoursFrom') as HTMLSelectElement | null;
  const untilEl = document.getElementById('quietHoursUntil') as HTMLSelectElement | null;
  const summaryEl = document.getElementById('quietHoursSummary');
  if (!enabledEl || !fromEl || !untilEl) return;

  fromEl.disabled = !enabledEl.checked;
  untilEl.disabled = !enabledEl.checked;

  if (summaryEl) {
    const from = Number(fromEl.value);
    const until = Number(untilEl.value);
    if (from === until) {
      summaryEl.textContent = 'No quiet hours: browsing is available all day.';
    } else {
      const overnight = from > until ? ' (overnight)' : '';
      summaryEl.textContent = `Quiet hours (browsing blocked): ${formatHour(from)}–${formatHour(until)}${overnight}.`;
    }
  }
}

function readQuietHoursFromForm(): Settings['timeLimits'] {
  const enabledEl = document.getElementById('timeLimitsEnabled') as HTMLInputElement | null;
  const fromEl = document.getElementById('quietHoursFrom') as HTMLSelectElement | null;
  const untilEl = document.getElementById('quietHoursUntil') as HTMLSelectElement | null;
  if (!enabledEl || !fromEl || !untilEl) return currentSettings.timeLimits;
  return {
    enabled: enabledEl.checked,
    // Quiet [from, until) is the complement of the stored allowed window [start, end).
    allowedHours: { start: Number(untilEl.value), end: Number(fromEl.value) },
  };
}

function setupEventListeners(): void {
  // Adding patterns
  const addRestrictedBtn = document.getElementById('addRestrictedBtn');
  if (addRestrictedBtn) {
    addRestrictedBtn.addEventListener('click', () => {
      const input = document.getElementById('newRestrictedPattern') as HTMLInputElement;
      const pattern = input?.value.trim();
      if (pattern) {
        addPattern('restrictedPatterns', pattern);
        if (input) input.value = '';
      }
    });
  }
  
  const addAllowedBtn = document.getElementById('addAllowedBtn');
  if (addAllowedBtn) {
    addAllowedBtn.addEventListener('click', () => {
      const input = document.getElementById('newAllowedPattern') as HTMLInputElement;
      const pattern = input?.value.trim();
      if (pattern) {
        addPattern('allowedPatterns', pattern);
        if (input) input.value = '';
      }
    });
  }
  
  const addIgnoredBtn = document.getElementById('addIgnoredBtn');
  if (addIgnoredBtn) {
    addIgnoredBtn.addEventListener('click', () => {
      const input = document.getElementById('newIgnoredPattern') as HTMLInputElement;
      const pattern = input?.value.trim();
      if (pattern) {
        addPattern('ignoredPatterns', pattern);
        if (input) input.value = '';
      }
    });
  }
  
  // Removing patterns
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('btn-remove')) {
      const index = parseInt(target.dataset.index || '0');
      const type = target.dataset.type || '';
      if (type === 'restricted') {
        removePattern('restrictedPatterns', index);
      } else if (type === 'allowed') {
        removePattern('allowedPatterns', index);
      } else if (type === 'ignored') {
        removePattern('ignoredPatterns', index);
      } else if (type === 'category') {
        removeClassificationItem('category', index);
      } else if (type === 'safetyLevel') {
        removeClassificationItem('safetyLevel', index);
      }
    }
  });

  // Add category / risk level: core/classification-limits decides (empty, too long, duplicate, limit)
  const addCategoryBtn = document.getElementById('addCategoryBtn');
  if (addCategoryBtn) {
    addCategoryBtn.addEventListener('click', () => {
      const input = document.getElementById('newCategoryInput') as HTMLInputElement;
      if (addClassificationItem('category', input?.value ?? '') && input) input.value = '';
    });
  }

  const addSafetyLevelBtn = document.getElementById('addSafetyLevelBtn');
  if (addSafetyLevelBtn) {
    addSafetyLevelBtn.addEventListener('click', () => {
      const input = document.getElementById('newSafetyLevelInput') as HTMLInputElement;
      if (addClassificationItem('safetyLevel', input?.value ?? '') && input) input.value = '';
    });
  }

  // Optional description of a category / risk level (delegated; no re-render, so typing keeps the focus)
  document.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    if (!target.classList.contains('classification-description')) return;
    const index = parseInt(target.dataset.index || '0');
    if (target.dataset.type === 'category') {
      currentSettings.categoryItems = withItemDescription(currentSettings.categoryItems ?? [], index, target.value);
    } else if (target.dataset.type === 'safetyLevel') {
      currentSettings.safetyLevelItems = withItemDescription(currentSettings.safetyLevelItems ?? [], index, target.value);
    }
  });

  // Toggle Allow/Block for classification items (delegated)
  document.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.classList.contains('toggle-input') && target.dataset.type) {
      const index = parseInt(target.dataset.index || '0');
      const type = target.dataset.type as 'category' | 'safetyLevel';
      if (type === 'category' || type === 'safetyLevel') {
        toggleClassificationItem(type, index);
      }
    }
  });
  
  // AI Classification tab: mode line, decision model picker, Test model, audience, prompts
  setupAiTabListeners(() => currentSettings);
  
  // AI Classification toggle - update dependent fields
  const aiEnableEl = document.getElementById('enableAIClassification') as HTMLInputElement;
  if (aiEnableEl) {
    aiEnableEl.addEventListener('change', updateAIClassificationDependentFields);
  }

  // Telegram commands toggle and polling interval - update dependent fields
  const tgCommandsEl = document.getElementById('enableTelegramCommands') as HTMLInputElement;
  if (tgCommandsEl) {
    tgCommandsEl.addEventListener('change', updateTelegramCommandsDependentFields);
  }
  const tgPollIntervalEl = document.getElementById('telegramPollInterval') as HTMLSelectElement;
  if (tgPollIntervalEl) {
    tgPollIntervalEl.addEventListener('change', updateTelegramCommandsDependentFields);
  }

  // Quiet hours toggle and hour selects - update dependent fields
  for (const id of ['timeLimitsEnabled', 'quietHoursFrom', 'quietHoursUntil']) {
    document.getElementById(id)?.addEventListener('change', updateQuietHoursDependentFields);
  }

  // Provider change handler
  const aiProviderEl = document.getElementById('aiProvider') as HTMLSelectElement;
  if (aiProviderEl) {
    aiProviderEl.addEventListener('change', () => {
      updateProviderHelpText(aiProviderEl.value);
      // Clear model list when provider changes
      const aiModelEl = document.getElementById('aiModel') as HTMLSelectElement;
      if (aiModelEl) {
        // Reset to default models based on provider
        if (aiProviderEl.value === 'openrouter') {
          aiModelEl.innerHTML = `
            <option value="openai/gpt-4">GPT-4 (OpenAI)</option>
            <option value="openai/gpt-3.5-turbo">GPT-3.5 Turbo (OpenAI)</option>
            <option value="anthropic/claude-3-opus">Claude 3 Opus (Anthropic)</option>
            <option value="anthropic/claude-3-sonnet">Claude 3 Sonnet (Anthropic)</option>
            <option value="anthropic/claude-3-haiku">Claude 3 Haiku (Anthropic)</option>
            <option value="google/gemini-pro">Gemini Pro (Google)</option>
            <option value="meta-llama/llama-3-70b-instruct">Llama 3 70B (Meta)</option>
          `;
        } else {
          aiModelEl.innerHTML = `
            <option value="gpt-4">GPT-4</option>
            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            <option value="claude-3-opus">Claude 3 Opus</option>
            <option value="claude-3-sonnet">Claude 3 Sonnet</option>
          `;
        }
      }
    });
  }

  // Load models button
  const loadModelsBtn = document.getElementById('loadModelsBtn') as HTMLButtonElement;
  if (loadModelsBtn) {
    loadModelsBtn.addEventListener('click', async () => {
      const providerEl = document.getElementById('aiProvider') as HTMLSelectElement;
      const tokenEl = document.getElementById('aiApiToken') as HTMLInputElement;
      const modelEl = document.getElementById('aiModel') as HTMLSelectElement;
      const provider = (providerEl?.value || 'github') as 'github' | 'openrouter';
      const token = tokenEl?.value?.trim() || '';
      if (modelEl) {
        await loadAvailableModels(provider, token, modelEl, loadModelsBtn);
      }
    });
  }
  
  // Clear AI error button
  const clearAIErrorBtn = document.getElementById('clearAIErrorBtn');
  if (clearAIErrorBtn) {
    clearAIErrorBtn.addEventListener('click', clearAIError);
  }
  
  // Telegram test
  const testTelegramBtn = document.getElementById('testTelegramBtn');
  if (testTelegramBtn) {
    testTelegramBtn.addEventListener('click', async () => {
      const tokenEl = document.getElementById('telegramBotToken') as HTMLInputElement;
      const chatSelectEl = document.getElementById('telegramChatId') as HTMLSelectElement;
      const chatManualEl = document.getElementById('telegramChatIdManual') as HTMLInputElement;
      const token = tokenEl?.value?.trim() || '';
      const chatId = (chatSelectEl?.value || chatManualEl?.value || '').trim();
      await testTelegram(token, chatId);
    });
  }

  // Load Telegram groups
  const loadGroupsBtn = document.getElementById('loadGroupsBtn') as HTMLButtonElement;
  if (loadGroupsBtn) {
    loadGroupsBtn.addEventListener('click', async () => {
      const tokenEl = document.getElementById('telegramBotToken') as HTMLInputElement;
      const chatSelectEl = document.getElementById('telegramChatId') as HTMLSelectElement;
      const token = tokenEl?.value?.trim() || '';
      if (chatSelectEl) {
        await loadTelegramGroups(token, chatSelectEl, loadGroupsBtn);
      }
    });
  }

  // Sync chat ID between select and manual input
  const tgChatEl = document.getElementById('telegramChatId') as HTMLSelectElement;
  const tgChatManualEl = document.getElementById('telegramChatIdManual') as HTMLInputElement;
  if (tgChatEl) {
    tgChatEl.addEventListener('change', () => {
      if (tgChatManualEl && tgChatEl.value) {
        tgChatManualEl.value = tgChatEl.value;
      }
    });
  }
  if (tgChatManualEl) {
    tgChatManualEl.addEventListener('input', () => {
      if (tgChatEl && tgChatManualEl.value) {
        // Clear select if manual input doesn't match any option
        const option = Array.from(tgChatEl.options).find(opt => opt.value === tgChatManualEl.value);
        if (!option) {
          tgChatEl.value = '';
        }
      }
    });
  }
  
  // Export/Import
  const exportBtn = document.getElementById('exportSettingsBtn');
  if (exportBtn) exportBtn.addEventListener('click', exportSettings);
  const importBtn = document.getElementById('importSettingsBtn');
  if (importBtn) {
    importBtn.addEventListener('click', () => {
      const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
      fileInput?.click();
    });
  }
  const fileInput = document.getElementById('importFileInput') as HTMLInputElement;
  if (fileInput) {
    fileInput.addEventListener('change', importSettings);
  }
  
  // Reset
  const resetBtn = document.getElementById('resetBtn');
  if (resetBtn) resetBtn.addEventListener('click', resetSettings);
  
  // Detect user name button
  const detectUserNameBtn = document.getElementById('detectUserNameBtn');
  if (detectUserNameBtn) {
    detectUserNameBtn.addEventListener('click', detectUserName);
  }
  
  // Form submission
  const form = document.getElementById('settingsForm') as HTMLFormElement;
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      saveSettings();
    });
  }
}

function setupTabs(): void {
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetTab = (btn as HTMLElement).dataset.tab;
      if (!targetTab) return;
      
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      const targetContent = document.getElementById(`tab-${targetTab}`);
      if (targetContent) targetContent.classList.add('active');
    });
  });
}

function addPattern(patternType: 'restrictedPatterns' | 'allowedPatterns' | 'ignoredPatterns', pattern: string): void {
  let patterns: string[];
  if (patternType === 'restrictedPatterns') {
    patterns = currentSettings.restrictedPatterns;
  } else if (patternType === 'allowedPatterns') {
    patterns = currentSettings.allowedPatterns;
  } else {
    patterns = currentSettings.ignoredPatterns || [];
  }
  
  if (!patterns.includes(pattern)) {
    if (patternType === 'restrictedPatterns') {
      currentSettings.restrictedPatterns = [...patterns, pattern];
      renderPatternList('restrictedPatternsList', currentSettings.restrictedPatterns, 'restricted');
    } else if (patternType === 'allowedPatterns') {
      currentSettings.allowedPatterns = [...patterns, pattern];
      renderPatternList('allowedPatternsList', currentSettings.allowedPatterns, 'allowed');
    } else {
      currentSettings.ignoredPatterns = [...patterns, pattern];
      renderPatternList('ignoredPatternsList', currentSettings.ignoredPatterns, 'ignored');
    }
  }
}

function removePattern(patternType: 'restrictedPatterns' | 'allowedPatterns' | 'ignoredPatterns', index: number): void {
  if (patternType === 'restrictedPatterns') {
    currentSettings.restrictedPatterns.splice(index, 1);
    renderPatternList('restrictedPatternsList', currentSettings.restrictedPatterns, 'restricted');
  } else if (patternType === 'allowedPatterns') {
    currentSettings.allowedPatterns.splice(index, 1);
    renderPatternList('allowedPatternsList', currentSettings.allowedPatterns, 'allowed');
  } else {
    if (!currentSettings.ignoredPatterns) {
      currentSettings.ignoredPatterns = [];
    }
    currentSettings.ignoredPatterns.splice(index, 1);
    renderPatternList('ignoredPatternsList', currentSettings.ignoredPatterns, 'ignored');
  }
}

/** Text of the add-row error toast (spec D-12). */
function describeItemError(code: 'empty' | 'too-long' | 'duplicate' | 'limit', kind: ItemKind): string {
  switch (code) {
    case 'empty': return 'Enter a name (1-40 characters).';
    case 'too-long': return 'The name is too long (maximum 40 characters).';
    case 'duplicate': return 'Already in list';
    default:
      return kind === 'category'
        ? `Category limit reached (${MAX_CATEGORY_ITEMS}). Remove one before adding another.`
        : `Risk level limit reached (${MAX_SAFETY_LEVEL_ITEMS}). Remove one before adding another.`;
  }
}

/** Adds an item unless the name is empty, too long, a duplicate or over the limit. Returns whether it was added. */
function addClassificationItem(type: 'category' | 'safetyLevel', rawName: string): boolean {
  const items = type === 'category' ? (currentSettings.categoryItems ?? []) : (currentSettings.safetyLevelItems ?? []);
  const kind: ItemKind = type === 'category' ? 'category' : 'safety';
  const checked = validateNewItem(rawName, items.map((i) => i.name), kind, items.length);
  if (!checked.ok) {
    showStatus(describeItemError(checked.code, kind), checked.code === 'duplicate' ? 'info' : 'error');
    return false;
  }
  const newItem: ClassificationItem = { name: checked.name, restricted: true };
  if (type === 'category') {
    currentSettings.categoryItems = [...items, newItem];
    renderClassificationItemList('categoryItemsList', currentSettings.categoryItems, 'category');
  } else {
    currentSettings.safetyLevelItems = [...items, newItem];
    renderClassificationItemList('safetyLevelItemsList', currentSettings.safetyLevelItems, 'safetyLevel');
  }
  return true;
}

/** The list with the description of one item replaced; an empty description removes the property. */
function withItemDescription(items: ClassificationItem[], index: number, raw: string): ClassificationItem[] {
  const current = items[index];
  if (!current) return items;
  const { description: _previous, ...rest } = current;
  const description = sanitizeItemDescription(raw);
  const updated: ClassificationItem = description ? { ...rest, description } : rest;
  return items.map((item, i) => (i === index ? updated : item));
}

function removeClassificationItem(type: 'category' | 'safetyLevel', index: number): void {
  if (type === 'category') {
    const items = currentSettings.categoryItems ?? [];
    items.splice(index, 1);
    currentSettings.categoryItems = [...items];
    renderClassificationItemList('categoryItemsList', currentSettings.categoryItems, 'category');
  } else {
    const items = currentSettings.safetyLevelItems ?? [];
    items.splice(index, 1);
    currentSettings.safetyLevelItems = [...items];
    renderClassificationItemList('safetyLevelItemsList', currentSettings.safetyLevelItems, 'safetyLevel');
  }
}

function toggleClassificationItem(type: 'category' | 'safetyLevel', index: number): void {
  if (type === 'category') {
    const items = [...(currentSettings.categoryItems ?? [])];
    if (items[index]) {
      items[index] = { ...items[index], restricted: !items[index].restricted };
      currentSettings.categoryItems = items;
      renderClassificationItemList('categoryItemsList', currentSettings.categoryItems, 'category');
    }
  } else {
    const items = [...(currentSettings.safetyLevelItems ?? [])];
    if (items[index]) {
      items[index] = { ...items[index], restricted: !items[index].restricted };
      currentSettings.safetyLevelItems = items;
      renderClassificationItemList('safetyLevelItemsList', currentSettings.safetyLevelItems, 'safetyLevel');
    }
  }
}

function updateProviderHelpText(provider: string): void {
  const providerHelpText = document.getElementById('providerHelpText');
  const tokenHelpText = document.getElementById('tokenHelpText');
  const tokenInput = document.getElementById('aiApiToken') as HTMLInputElement;
  
  if (provider === 'openrouter') {
    if (providerHelpText) {
      providerHelpText.textContent = 'OpenRouter.ai provides access to multiple AI models from various providers';
    }
    if (tokenHelpText) {
      tokenHelpText.textContent = 'Get API key at https://openrouter.ai/keys. OpenRouter supports many models including GPT-4, Claude, Gemini, Llama, and more.';
    }
    if (tokenInput) {
      tokenInput.placeholder = 'Paste your OpenRouter API key';
    }
  } else {
    if (providerHelpText) {
      providerHelpText.textContent = 'Get token on GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic)';
    }
    if (tokenHelpText) {
      tokenHelpText.textContent = 'Get token on GitHub: Settings → Developer settings → Personal access tokens → Tokens (classic)';
    }
    if (tokenInput) {
      tokenInput.placeholder = 'ghp_xxxxxxxxxxxx';
    }
  }
}

async function saveSettings(): Promise<void> {
  try {
    commitAudienceField();
    // Nothing is written when the decision stage is enabled but unusable (inline errors, focus, toast).
    if (!validateAiTab()) return;
    const restrictedMsgEl = document.getElementById('restrictedPageMessage') as HTMLTextAreaElement;
    const aiValues = readAiTabValues();
    const tgTokenEl = document.getElementById('telegramBotToken') as HTMLInputElement;
    const tgChatSelectEl = document.getElementById('telegramChatId') as HTMLSelectElement;
    const tgChatManualEl = document.getElementById('telegramChatIdManual') as HTMLInputElement;
    const tgEnableEl = document.getElementById('enableTelegramNotifications') as HTMLInputElement;
    const tgFreqEl = document.getElementById('notificationFrequency') as HTMLSelectElement;
    
    // Get notification types from checkboxes
    const notificationTypes: ('restricted' | 'suspicious' | 'weekly' | 'timeLimit')[] = [];
    const restrictedTypeEl = document.getElementById('notificationTypeRestricted') as HTMLInputElement;
    const suspiciousTypeEl = document.getElementById('notificationTypeSuspicious') as HTMLInputElement;
    const weeklyTypeEl = document.getElementById('notificationTypeWeekly') as HTMLInputElement;
    const timeLimitTypeEl = document.getElementById('notificationTypeTimeLimit') as HTMLInputElement;
    if (restrictedTypeEl?.checked) notificationTypes.push('restricted');
    if (suspiciousTypeEl?.checked) notificationTypes.push('suspicious');
    if (weeklyTypeEl?.checked) notificationTypes.push('weekly');
    if (timeLimitTypeEl?.checked) notificationTypes.push('timeLimit');
    
    // Get page notification types from checkboxes
    const pageNotificationTypes: ('restricted' | 'allowed' | 'educational' | 'nonEducational')[] = [];
    const pageRestrictedTypeEl = document.getElementById('pageNotificationTypeRestricted') as HTMLInputElement;
    const pageAllowedTypeEl = document.getElementById('pageNotificationTypeAllowed') as HTMLInputElement;
    const pageEducationalTypeEl = document.getElementById('pageNotificationTypeEducational') as HTMLInputElement;
    const pageNonEducationalTypeEl = document.getElementById('pageNotificationTypeNonEducational') as HTMLInputElement;
    if (pageRestrictedTypeEl?.checked) pageNotificationTypes.push('restricted');
    if (pageAllowedTypeEl?.checked) pageNotificationTypes.push('allowed');
    if (pageEducationalTypeEl?.checked) pageNotificationTypes.push('educational');
    if (pageNonEducationalTypeEl?.checked) pageNotificationTypes.push('nonEducational');
    
    // Get chat ID from either select or manual input (manual input takes priority if both filled)
    const chatId = (tgChatManualEl?.value?.trim() || tgChatSelectEl?.value?.trim() || '');
    const userNameEl = document.getElementById('userProfileName') as HTMLInputElement;
    const pwdEl = document.getElementById('parentPassword') as HTMLInputElement;
    const hintEl = document.getElementById('passwordHint') as HTMLInputElement;
    const enableSystemLogsEl = document.getElementById('enableSystemLogs') as HTMLInputElement;
    
    const oldPassword = currentSettings.parentPassword || '';
    const newPassword = pwdEl?.value || '';
    
    const settings: Settings = {
      restrictedPatterns: currentSettings.restrictedPatterns || [],
      allowedPatterns: currentSettings.allowedPatterns || [],
      ignoredPatterns: currentSettings.ignoredPatterns || [],
      restrictedPageMessage: restrictedMsgEl?.value || '',
      ...aiValues,
      categoryItems: currentSettings.categoryItems ?? [],
      safetyLevelItems: currentSettings.safetyLevelItems ?? [],
      telegramBotToken: tgTokenEl?.value || '',
      telegramChatId: chatId,
      enableTelegramNotifications: tgEnableEl?.checked !== false,
      enableTelegramCommands: (document.getElementById('enableTelegramCommands') as HTMLInputElement)?.checked === true,
      telegramPollIntervalMinutes: parseFloat((document.getElementById('telegramPollInterval') as HTMLSelectElement)?.value || '1') || 1,
      notificationFrequency: (tgFreqEl?.value || 'instant') as 'instant' | 'hourly' | 'daily',
      notificationTypes: notificationTypes.length > 0 ? notificationTypes : ['restricted', 'suspicious', 'weekly', 'timeLimit'],
      pageNotificationTypes: pageNotificationTypes.length > 0 ? pageNotificationTypes : ['restricted', 'nonEducational'],
      userProfileName: userNameEl?.value?.trim() || '',
      parentPassword: newPassword,
      passwordHint: hintEl?.value || 'Enter word "friend"',
      enableSystemLogs: enableSystemLogsEl?.checked !== false, // Default to true
      timeLimits: readQuietHoursFromForm()
    };
    
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
    currentSettings = settings;
    
    const limitWarnings = [
      ...getClassificationLimitWarnings(settings.categoryItems, 'category'),
      ...getClassificationLimitWarnings(settings.safetyLevelItems, 'safety'),
    ];
    showStatus(['Settings saved successfully!', ...limitWarnings].join(' '), 'success');
    
    // If password changed, clear session auth and reload page
    if (oldPassword !== newPassword) {
      sessionStorage.removeItem('settingsAuthenticated');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      return;
    }
    
    // Reload restriction rules in background script
    chrome.runtime.sendMessage({ type: 'reloadRules' }).catch(() => {});
    
  } catch (error) {
    showStatus('Error saving: ' + (error instanceof Error ? error.message : String(error)), 'error');
  }
}

function exportSettings(): void {
  const dataStr = JSON.stringify(currentSettings, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `focus-saving-settings-${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showStatus('Settings exported', 'success');
}

function migrateImportedSettings(imported: Record<string, unknown>): Settings {
  const s = imported as Partial<Settings>;
  let categoryItems = s.categoryItems;
  let safetyLevelItems = s.safetyLevelItems;
  if (!categoryItems?.length && (s.availableCategories?.length || s.restrictedCategories?.length)) {
    const avail = (s.availableCategories || []) as string[];
    const restr = (s.restrictedCategories || []) as string[];
    const seen = new Set<string>();
    categoryItems = [];
    for (const n of [...avail, ...restr]) {
      const name = String(n).trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        categoryItems!.push({ name, restricted: restr.some((r) => String(r).trim().toLowerCase() === name.toLowerCase()) });
      }
    }
  }
  if (!safetyLevelItems?.length && (s.availableSafetyLevels?.length || s.restrictedSafetyLevels?.length)) {
    const avail = (s.availableSafetyLevels || []) as string[];
    const restr = (s.restrictedSafetyLevels || []) as string[];
    const seen = new Set<string>();
    safetyLevelItems = [];
    for (const n of [...avail, ...restr]) {
      const name = String(n).trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        safetyLevelItems!.push({ name, restricted: restr.some((r) => String(r).trim().toLowerCase() === name.toLowerCase()) });
      }
    }
  }
  const defaults = getDefaultSettings();
  const base = {
    ...defaults,
    ...s,
    categoryItems: categoryItems ?? defaults.categoryItems,
    safetyLevelItems: safetyLevelItems ?? defaults.safetyLevelItems,
  } as Settings;
  // Old exports have no audience: derive it from the exported single-call prompt, like the stored-settings migration.
  if (typeof s.aiAudience !== 'string') base.aiAudience = deriveAudience(s.aiClassificationPrompt);
  return normalizeSettingsShape(base);
}

async function importSettings(e: Event): Promise<void> {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const imported = JSON.parse(text) as Record<string, unknown>;
    
    if (confirm('Import settings? Current settings will be replaced.')) {
      currentSettings = migrateImportedSettings(imported);
      populateForm(currentSettings);
      await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: currentSettings });
      showStatus('Settings imported', 'success');
    }
  } catch (error) {
    showStatus('Import error: ' + (error instanceof Error ? error.message : String(error)), 'error');
  }
  
  target.value = '';
}

async function resetSettings(): Promise<void> {
  if (confirm('Reset all settings to default values?')) {
    currentSettings = getDefaultSettings();
    populateForm(currentSettings);
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: currentSettings });
    showStatus('Settings reset', 'success');
    // Clear session auth when password is reset
    sessionStorage.removeItem('settingsAuthenticated');
    // Reload page to show password gate if password is set
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }
}

async function detectUserName(): Promise<void> {
  const userNameEl = document.getElementById('userProfileName') as HTMLInputElement;
  const detectBtn = document.getElementById('detectUserNameBtn') as HTMLButtonElement;
  
  if (!userNameEl) return;
  
  // Disable button and show loading state
  if (detectBtn) {
    detectBtn.disabled = true;
    detectBtn.textContent = 'Detecting...';
  }
  
  try {
    // Try to get Chrome profile user info
    if (chrome.identity && typeof chrome.identity.getProfileUserInfo === 'function') {
      chrome.identity.getProfileUserInfo((userInfo) => {
        const error = chrome.runtime.lastError;
        
        if (error) {
          // API error - try fallback
          tryGetChromeProfileName(userNameEl, detectBtn);
          return;
        }
        
        if (userInfo) {
          // Extract name from email (part before @) or use email
          let userName = '';
          if (userInfo.email) {
            userName = userInfo.email.split('@')[0];
            // Capitalize first letter
            userName = userName.charAt(0).toUpperCase() + userName.slice(1);
          } else if (userInfo.id) {
            userName = `User ${userInfo.id.substring(0, 8)}`;
          }
          
          if (userName) {
            userNameEl.value = userName;
            showStatus('User name detected automatically', 'success');
          } else {
            showStatus('Failed to detect user name. Please enter manually.', 'error');
          }
        } else {
          // No user info - try fallback
          tryGetChromeProfileName(userNameEl, detectBtn);
          return;
        }
        
        if (detectBtn) {
          detectBtn.disabled = false;
          detectBtn.textContent = 'Detect Automatically';
        }
      });
    } else {
      // API not available - try fallback
      tryGetChromeProfileName(userNameEl, detectBtn);
    }
  } catch (error) {
    showStatus('Error detecting name: ' + (error instanceof Error ? error.message : String(error)), 'error');
    if (detectBtn) {
      detectBtn.disabled = false;
      detectBtn.textContent = 'Detect Automatically';
    }
  }
}

async function tryGetChromeProfileName(userNameEl: HTMLInputElement, detectBtn: HTMLButtonElement | null): Promise<void> {
  try {
    // Try to get from Chrome sync storage (Chrome may store profile name there)
    chrome.storage.sync.get(['profile_name', 'profile'], (result) => {
      if (result.profile_name) {
        userNameEl.value = result.profile_name;
        showStatus('User name detected from Chrome profile', 'success');
        if (detectBtn) {
          detectBtn.disabled = false;
          detectBtn.textContent = 'Detect Automatically';
        }
        return;
      }
      
      // If sync storage doesn't have it, show message
      showStatus('Automatic detection unavailable. Please enter name manually.', 'error');
      if (detectBtn) {
        detectBtn.disabled = false;
        detectBtn.textContent = 'Detect Automatically';
      }
    });
  } catch (error) {
    showStatus('Automatic detection unavailable. Please enter name manually.', 'error');
    if (detectBtn) {
      detectBtn.disabled = false;
      detectBtn.textContent = 'Detect Automatically';
    }
  }
}

function displayAIError(errorMessage: string): void {
  const errorDisplay = document.getElementById('aiErrorDisplay');
  const errorText = document.getElementById('aiErrorText');
  if (errorDisplay && errorText) {
    errorText.textContent = `⚠️ AI Classification Error: ${errorMessage}`;
    errorDisplay.classList.remove('hidden');
  }
}

function clearAIError(): void {
  const errorDisplay = document.getElementById('aiErrorDisplay');
  if (errorDisplay) {
    errorDisplay.classList.add('hidden');
  }
  const errorText = document.getElementById('aiErrorText');
  if (errorText) {
    errorText.textContent = '';
  }
  chrome.storage.local.remove(STORAGE_KEYS.LAST_AI_ERROR);
}
