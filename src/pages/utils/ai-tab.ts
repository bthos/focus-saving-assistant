/**
 * Options page, "AI Classification" tab: mode line, decision model picker with "Test model", explanation
 * model, audience, prompts. Which mode is active, what may be saved and what a test result says all come
 * from the pure core modules (the same functions the service worker uses); this file only wires the DOM.
 */

import type { Settings } from '../../types/index.js';
import { DEFAULT_SETTINGS } from '../../core/default-settings.ts';
import { isStage1Configured, isStage2Active, resolveAiMode, resolveDecisionToken } from '../../core/ai-mode.ts';
import type { DecisionCatalogEntry } from '../../core/decision-catalog.ts';
import {
  getDecisionModelStatus,
  validateDecisionSettings,
  type DecisionModelStatus,
  type DecisionSettingsError,
} from '../../core/decision-models.ts';
import { AUDIENCE_MAX_CHARS } from '../../core/decision-request.ts';
import { buildExplanationPrompt } from '../../core/explanation.ts';
import { showStatus } from './form-helpers.js';
import {
  loadDecisionModels,
  renderDecisionModelOptions,
  testDecisionModel,
  type DecisionModelOption,
} from './ai-models-handler.js';

/** The AI tab's form values, shaped like the settings they are saved into. */
export type AiTabValues = Pick<
  Settings,
  | 'enableAIClassification'
  | 'aiProvider'
  | 'aiApiToken'
  | 'aiModel'
  | 'aiClassificationPrompt'
  | 'decisionEnabled'
  | 'decisionApiToken'
  | 'decisionModel'
  | 'aiAudience'
  | 'enableAIExplanation'
  | 'aiExplanationPrompt'
>;

/** Slugs whose "Test model" passed on this page (kept until the page closes). */
const testedOk = new Set<string>();
/** Entries of the last loaded catalog by slug (price and context for the info line). */
const decisionCatalog = new Map<string, DecisionCatalogEntry>();
let testRunning = false;

const MODE_TEXT = {
  off: 'AI classification is off. No pages are classified.',
  unset: 'AI classification is not set up yet. Add an API token for the explanation model (single call) or set up a decision model.',
  single: 'Single call: one model classifies every page and writes the reason. Set up a decision model below for a faster verdict.',
  twoStage: 'Two-stage: the decision model decides at once; the explanation model writes the reason and a suggestion for blocked pages.',
  decisionOnlyOff: 'Decision only: pages are classified by the decision model. Blocked pages get a short automatic reason and no suggestion (explanations are turned off).',
  decisionOnlyNoToken: 'Decision only: pages are classified by the decision model. Blocked pages get a short automatic reason and no suggestion (no explanation-model token).',
  notReadySuffix: ' The decision model is not ready yet (it needs a pinned model and an OpenRouter key), so it is not used.',
} as const;

const REUSE_TEXT = {
  willReuse: 'Empty: the OpenRouter key of the explanation model will be used.',
  noKey: 'Empty and the explanation model has no key either: enter a key.',
  github: 'Empty: the explanation model uses GitHub, and a GitHub token is never sent to OpenRouter. Enter an OpenRouter key.',
} as const;

const STATUS_SUFFIX: Record<DecisionModelStatus, string> = {
  recommended: ' · recommended',
  verified: ' · verified with this extension',
  'not-recommended': ' · works, but not recommended: its risk answers were almost always "Low" in testing',
  unverified: ' · not verified yet: press "Test model"',
  incompatible: ' · this model rejects the request and cannot be used',
};

const NOT_RECOMMENDED_NOTE = 'Works, but not recommended: its risk answers were almost always Low in testing.';

const EXPLANATION_PREVIEW_EXAMPLE = {
  url: 'https://example.com/games',
  title: 'Example Games Page',
  category: 'Games',
  riskLevel: 'Medium',
} as const;

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setDisabled(ids: readonly string[], disabled: boolean): void {
  for (const id of ids) {
    const control = el<HTMLInputElement>(id);
    if (control) control.disabled = disabled;
  }
}

/** Removes the "Return JSON" instructions: the extension adds the reply format itself. */
function stripJsonInstructions(prompt: string): string {
  return prompt
    .replace(/Return JSON:.*$/im, '')
    .replace(/return JSON:.*$/im, '')
    .trim();
}

/** Reads the AI tab as it is on screen (unsaved). */
export function readAiTabValues(): AiTabValues {
  const audience = (el<HTMLInputElement>('aiAudience')?.value ?? '').trim().slice(0, AUDIENCE_MAX_CHARS);
  return {
    enableAIClassification: el<HTMLInputElement>('enableAIClassification')?.checked !== false,
    aiProvider: (el<HTMLSelectElement>('aiProvider')?.value || 'github') as Settings['aiProvider'],
    aiApiToken: el<HTMLInputElement>('aiApiToken')?.value || '',
    aiModel: el<HTMLSelectElement>('aiModel')?.value || '',
    aiClassificationPrompt: stripJsonInstructions(
      el<HTMLTextAreaElement>('aiClassificationPrompt')?.value || DEFAULT_SETTINGS.aiClassificationPrompt
    ),
    decisionEnabled: el<HTMLInputElement>('decisionEnabled')?.checked === true,
    decisionApiToken: (el<HTMLInputElement>('decisionApiToken')?.value ?? '').trim(),
    decisionModel: el<HTMLSelectElement>('decisionModel')?.value ?? '',
    aiAudience: audience || DEFAULT_SETTINGS.aiAudience,
    enableAIExplanation: el<HTMLInputElement>('enableAIExplanation')?.checked !== false,
    aiExplanationPrompt: (el<HTMLTextAreaElement>('aiExplanationPrompt')?.value ?? '').trim() || DEFAULT_SETTINGS.aiExplanationPrompt,
  };
}

function describeAiMode(values: AiTabValues): string {
  if (!values.enableAIClassification) return MODE_TEXT.off;
  let text: string;
  const mode = resolveAiMode(values);
  if (mode === 'off') {
    text = MODE_TEXT.unset;
  } else if (mode === 'single') {
    text = MODE_TEXT.single;
  } else if (isStage2Active(values)) {
    text = MODE_TEXT.twoStage;
  } else {
    text = values.enableAIExplanation ? MODE_TEXT.decisionOnlyNoToken : MODE_TEXT.decisionOnlyOff;
  }
  if (values.decisionEnabled && !isStage1Configured(values)) {
    text += MODE_TEXT.notReadySuffix;
  }
  return text;
}

function describeTokenReuse(values: AiTabValues): string {
  if (values.decisionApiToken) return '';
  if (values.aiProvider !== 'openrouter') return REUSE_TEXT.github;
  return values.aiApiToken.trim() ? REUSE_TEXT.willReuse : REUSE_TEXT.noKey;
}

/** "Pinned build: <slug>" plus price/context (catalog loaded) and the status of the selected model. */
function updateDecisionModelInfo(): void {
  const info = el('decisionModelInfo');
  const note = el('decisionModelNote');
  if (!info) return;
  const slug = el<HTMLSelectElement>('decisionModel')?.value ?? '';
  info.textContent = '';
  note?.classList.add('hidden');
  if (!slug) return;

  const code = document.createElement('code');
  code.textContent = slug;
  info.append('Pinned build: ', code);

  let suffix = '';
  const entry = decisionCatalog.get(slug);
  if (entry) {
    const price = entry.priceLabel === 'free' || entry.priceLabel === 'n/a' ? entry.priceLabel : `${entry.priceLabel} tokens`;
    suffix += ` · ${entry.contextLabel.replace(/ ctx$/, ' context')} · ${price}`;
  } else if (decisionCatalog.size > 0) {
    suffix += ' · not in the loaded list, it may have been retired';
  }
  const status = getDecisionModelStatus(slug);
  suffix += status === 'unverified' && testedOk.has(slug) ? ' · test passed on this page' : STATUS_SUFFIX[status];
  info.append(suffix);

  if (note && status === 'not-recommended') {
    note.textContent = NOT_RECOMMENDED_NOTE;
    note.classList.remove('hidden');
  }
}

function updatePromptPreviews(): void {
  const audience = (el<HTMLInputElement>('aiAudience')?.value ?? '').trim() || DEFAULT_SETTINGS.aiAudience;

  const singlePrompt = el<HTMLTextAreaElement>('aiClassificationPrompt');
  const singlePreview = el('promptPreview');
  if (singlePrompt && singlePreview) {
    // Replacer functions: a "$" in the text is literal.
    const substituted = (singlePrompt.value || '')
      .replace(/{url}/g, () => 'https://example.com/educational-page')
      .replace(/{title}/g, () => 'Example Educational Page')
      .replace(/{audience}/g, () => audience);
    const systemPrompt = 'Return JSON: {isEducational: boolean, suggestedUrl: string, noUrlReason: string, category: string, isAgeAppropriate: boolean, safetyLevel: string, reason: string}';
    singlePreview.textContent = substituted ? `${substituted}\n\n${systemPrompt}` : systemPrompt;
  }

  const explanationPrompt = el<HTMLTextAreaElement>('aiExplanationPrompt');
  const explanationPreview = el('explanationPromptPreview');
  if (explanationPrompt && explanationPreview) {
    explanationPreview.textContent = buildExplanationPrompt(explanationPrompt.value, {
      ...EXPLANATION_PREVIEW_EXAMPLE,
      audience,
    });
  }
}

/** Recomputes mode line, disabled states, key-reuse sentence, warning and model info from the form. */
export function refreshAiTab(): void {
  const values = readAiTabValues();
  const master = values.enableAIClassification;
  const decisionOn = values.decisionEnabled;
  const mode = resolveAiMode(values);

  const modeLine = el('aiModeLine');
  if (modeLine) modeLine.textContent = describeAiMode(values);

  setDisabled(['decisionEnabled'], !master);
  setDisabled(['decisionApiToken', 'decisionModel', 'loadDecisionModelsBtn'], !master || !decisionOn);
  setDisabled(
    ['testDecisionModelBtn'],
    testRunning || !master || !decisionOn || !values.decisionModel || resolveDecisionToken(values) === ''
  );
  setDisabled(['enableAIExplanation'], !master || !decisionOn);
  // In single/off mode these controls are the classifier itself, so they stay editable.
  setDisabled(
    ['aiProvider', 'aiApiToken', 'aiModel', 'loadModelsBtn'],
    !master || (mode === 'two-stage' && !values.enableAIExplanation)
  );
  setDisabled(['aiExplanationPrompt', 'resetExplanationPromptBtn'], !master || mode !== 'two-stage' || !values.enableAIExplanation);
  setDisabled(['aiAudiencePreset', 'aiAudience'], !master);
  setDisabled(['aiClassificationPrompt', 'resetClassificationPromptBtn'], !master || mode === 'two-stage');

  el('explanationNoTokenWarning')?.classList.toggle(
    'hidden',
    !(master && decisionOn && values.enableAIExplanation && values.aiApiToken.trim() === '')
  );

  const reuse = el('decisionTokenReuse');
  if (reuse) reuse.textContent = describeTokenReuse(values);

  updateDecisionModelInfo();
  updatePromptPreviews();
}

const DECISION_ERROR_ELEMENTS: Record<DecisionSettingsError['field'], { control: string; error: string }> = {
  decisionApiToken: { control: 'decisionApiToken', error: 'decisionTokenError' },
  decisionModel: { control: 'decisionModel', error: 'decisionModelError' },
};

function clearDecisionError(field: DecisionSettingsError['field']): void {
  const ids = DECISION_ERROR_ELEMENTS[field];
  const errorEl = el(ids.error);
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }
  el(ids.control)?.removeAttribute('aria-invalid');
}

/** First rule that fails per field: a missing key and a bad model are reported together. */
function collectDecisionErrors(values: AiTabValues): DecisionSettingsError[] {
  const first = validateDecisionSettings(values, testedOk);
  if (!first) return [];
  if (first.field !== 'decisionApiToken') return [first];
  // The pure rules stop at the first failure; re-run them with the key rule satisfied to also report the model.
  const model = validateDecisionSettings({ ...values, decisionApiToken: 'placeholder' }, testedOk);
  return model ? [first, model] : [first];
}

/**
 * Save-time validation of the decision stage (only when it is enabled). On failure shows the inline errors,
 * switches to this tab, focuses the first failing control and returns false: nothing may be written then.
 */
export function validateAiTab(): boolean {
  clearDecisionError('decisionApiToken');
  clearDecisionError('decisionModel');
  const errors = collectDecisionErrors(readAiTabValues());
  if (errors.length === 0) return true;

  for (const error of errors) {
    const ids = DECISION_ERROR_ELEMENTS[error.field];
    const errorEl = el(ids.error);
    if (errorEl) {
      errorEl.textContent = error.message;
      errorEl.classList.remove('hidden');
    }
    el(ids.control)?.setAttribute('aria-invalid', 'true');
  }
  document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="ai"]')?.click();
  el(DECISION_ERROR_ELEMENTS[errors[0].field].control)?.focus();
  showStatus('Fix the highlighted fields before saving.', 'error');
  return false;
}

/** An empty audience is saved as the default and written back to the field. */
export function commitAudienceField(): void {
  const audienceEl = el<HTMLInputElement>('aiAudience');
  if (!audienceEl) return;
  audienceEl.value = readAiTabValues().aiAudience;
  syncAudiencePreset();
}

function audiencePresetValues(): string[] {
  const presetEl = el<HTMLSelectElement>('aiAudiencePreset');
  return presetEl ? Array.from(presetEl.options).map((o) => o.value).filter((v) => v !== '') : [];
}

/** The preset select shows the preset equal to the text, else "Custom…". */
function syncAudiencePreset(): void {
  const presetEl = el<HTMLSelectElement>('aiAudiencePreset');
  const audienceEl = el<HTMLInputElement>('aiAudience');
  if (!presetEl || !audienceEl) return;
  const text = audienceEl.value.trim();
  presetEl.value = audiencePresetValues().includes(text) ? text : '';
}

function savedModelOption(slug: string): DecisionModelOption {
  const status = getDecisionModelStatus(slug);
  const verified = status === 'recommended' || status === 'verified' || status === 'not-recommended';
  return { slug, label: `${verified ? '✓ ' : ''}${slug}`, status };
}

/** Fills the AI tab from settings. `initial` also opens the single-call prompt when that is the active mode. */
export function populateAiTab(settings: Settings, options: { initial?: boolean } = {}): void {
  const decisionEnabledEl = el<HTMLInputElement>('decisionEnabled');
  if (decisionEnabledEl) decisionEnabledEl.checked = settings.decisionEnabled === true;
  const decisionTokenEl = el<HTMLInputElement>('decisionApiToken');
  if (decisionTokenEl) decisionTokenEl.value = settings.decisionApiToken || '';

  const decisionModelEl = el<HTMLSelectElement>('decisionModel');
  if (decisionModelEl) {
    const saved = settings.decisionModel || '';
    const listed = decisionCatalog.size > 0 ? [...decisionCatalog.values()] : [];
    renderDecisionModelOptions(decisionModelEl, listed.length > 0 || !saved ? listed : [savedModelOption(saved)], saved);
  }

  const explanationEl = el<HTMLInputElement>('enableAIExplanation');
  if (explanationEl) explanationEl.checked = settings.enableAIExplanation !== false;
  const explanationPromptEl = el<HTMLTextAreaElement>('aiExplanationPrompt');
  if (explanationPromptEl) explanationPromptEl.value = settings.aiExplanationPrompt || DEFAULT_SETTINGS.aiExplanationPrompt;
  const audienceEl = el<HTMLInputElement>('aiAudience');
  if (audienceEl) audienceEl.value = settings.aiAudience || DEFAULT_SETTINGS.aiAudience;
  syncAudiencePreset();

  const singlePromptEl = el<HTMLTextAreaElement>('aiClassificationPrompt');
  if (singlePromptEl) {
    singlePromptEl.value = stripJsonInstructions(settings.aiClassificationPrompt || DEFAULT_SETTINGS.aiClassificationPrompt);
  }

  const testResult = el('decisionModelTestResult');
  if (testResult) testResult.textContent = '';
  clearDecisionError('decisionApiToken');
  clearDecisionError('decisionModel');

  refreshAiTab();

  if (options.initial) {
    const details = el<HTMLDetailsElement>('singlePromptDetails');
    if (details) details.open = resolveAiMode(readAiTabValues()) === 'single';
  }
}

async function runModelTest(getSettings: () => Settings): Promise<void> {
  const button = el<HTMLButtonElement>('testDecisionModelBtn');
  const result = el('decisionModelTestResult');
  const values = readAiTabValues();
  const slug = values.decisionModel;
  if (!button || !slug) return;

  const lists = getSettings();
  testRunning = true;
  button.textContent = 'Testing...';
  refreshAiTab();
  try {
    const outcome = await testDecisionModel({
      decisionApiToken: values.decisionApiToken,
      decisionModel: slug,
      aiProvider: values.aiProvider,
      aiApiToken: values.aiApiToken,
      aiAudience: values.aiAudience,
      categoryItems: lists.categoryItems ?? [],
      safetyLevelItems: lists.safetyLevelItems ?? [],
    });
    if (outcome.passed) testedOk.add(slug);
    // The answer belongs to the model that was tested; show it only while that model is still selected.
    if (result && el<HTMLSelectElement>('decisionModel')?.value === slug) {
      result.textContent = outcome.text;
    }
  } finally {
    testRunning = false;
    button.textContent = 'Test model';
    refreshAiTab();
  }
}

/** Wires every control of the tab. `getSettings` gives the live lists (category/safety items) for the test. */
export function setupAiTabListeners(getSettings: () => Settings): void {
  for (const id of ['enableAIClassification', 'decisionEnabled', 'enableAIExplanation', 'aiProvider']) {
    el(id)?.addEventListener('change', refreshAiTab);
  }
  for (const id of ['aiApiToken', 'aiAudience']) {
    el(id)?.addEventListener('input', refreshAiTab);
  }

  const clearTestResult = (): void => {
    const result = el('decisionModelTestResult');
    if (result) result.textContent = '';
  };

  el('decisionApiToken')?.addEventListener('input', () => {
    clearDecisionError('decisionApiToken');
    clearTestResult();
    refreshAiTab();
  });
  el('decisionModel')?.addEventListener('change', () => {
    clearDecisionError('decisionModel');
    clearTestResult();
    refreshAiTab();
  });

  const loadBtn = el<HTMLButtonElement>('loadDecisionModelsBtn');
  loadBtn?.addEventListener('click', async () => {
    const selectEl = el<HTMLSelectElement>('decisionModel');
    if (!selectEl) return;
    const entries = await loadDecisionModels(resolveDecisionToken(readAiTabValues()), selectEl, loadBtn);
    if (entries) {
      decisionCatalog.clear();
      for (const entry of entries) decisionCatalog.set(entry.slug, entry);
    }
    refreshAiTab();
  });

  el('testDecisionModelBtn')?.addEventListener('click', () => void runModelTest(getSettings));

  el('aiAudiencePreset')?.addEventListener('change', () => {
    const presetEl = el<HTMLSelectElement>('aiAudiencePreset');
    const audienceEl = el<HTMLInputElement>('aiAudience');
    if (!presetEl || !audienceEl) return;
    if (presetEl.value === '') {
      audienceEl.focus();
    } else {
      audienceEl.value = presetEl.value;
    }
    refreshAiTab();
  });
  el('aiAudience')?.addEventListener('input', syncAudiencePreset);

  for (const id of ['aiExplanationPrompt', 'aiClassificationPrompt']) {
    el(id)?.addEventListener('input', updatePromptPreviews);
  }
  el('resetExplanationPromptBtn')?.addEventListener('click', () => {
    const promptEl = el<HTMLTextAreaElement>('aiExplanationPrompt');
    if (promptEl) promptEl.value = DEFAULT_SETTINGS.aiExplanationPrompt;
    updatePromptPreviews();
  });
  el('resetClassificationPromptBtn')?.addEventListener('click', () => {
    const promptEl = el<HTMLTextAreaElement>('aiClassificationPrompt');
    if (promptEl) promptEl.value = stripJsonInstructions(DEFAULT_SETTINGS.aiClassificationPrompt);
    updatePromptPreviews();
  });
}
