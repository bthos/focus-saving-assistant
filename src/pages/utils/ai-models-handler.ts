/**
 * AI Models handler for loading and managing AI models
 */

import type { Settings } from '../../types/index.js';
import { showStatus } from './form-helpers.js';
import { parseDecisionCatalog, type DecisionCatalogEntry } from '../../core/decision-catalog.ts';
import { getDecisionModelStatus, describeDecisionTestResult, type DecisionModelStatus, type DecisionTestResult } from '../../core/decision-models.ts';
import { buildDecisionRequest } from '../../core/decision-request.ts';
import { runDecisionRequest } from '../../utils/decision-classifier.js';

export interface AIModel {
  id: string;
  name: string;
  description?: string;
  pricing?: {
    prompt?: string;
    completion?: string;
    request?: string;
  };
}

/**
 * Fetch available models from GitHub or OpenRouter API
 */
export async function fetchAvailableModels(
  provider: 'github' | 'openrouter',
  apiToken: string
): Promise<AIModel[]> {
  if (!apiToken) {
    return [];
  }

  try {
    if (provider === 'openrouter') {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      return (data.data || []) as AIModel[];
    } else {
      const response = await fetch('https://models.github.ai/catalog/models', {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('GitHub Models API error:', response.status, errorText);
        throw new Error(`GitHub Models API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      // GitHub Models API returns an array directly, not wrapped in {models: [...]}
      return (Array.isArray(data) ? data : (data.models || [])) as AIModel[];
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error fetching models:', errorMessage);
    throw error; // Re-throw to allow caller to handle and display error
  }
}

/**
 * Load available models into select element
 */
export async function loadAvailableModels(
  provider: 'github' | 'openrouter',
  apiToken: string,
  modelSelectEl: HTMLSelectElement,
  loadBtn?: HTMLButtonElement
): Promise<void> {
  if (!apiToken) {
    showStatus('Please enter API Token first', 'error');
    return;
  }

  // Disable button and show loading state
  if (loadBtn) {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Loading...';
  }

  try {
    const models = await fetchAvailableModels(provider, apiToken);

    if (models.length === 0) {
      showStatus('No models found. Check your API token and ensure it has "Models: Read" permission.', 'error');
      if (loadBtn) {
        loadBtn.disabled = false;
        loadBtn.textContent = 'Load Available Models';
      }
      return;
    }

    // Clear existing options
    modelSelectEl.innerHTML = '';

    // Add models to select
    if (provider === 'openrouter') {
      // Sort: free models first, then paid models
      const sortedModels = [...models].sort((a, b) => {
        const aIsFree = a.pricing &&
          a.pricing.prompt === "0" &&
          a.pricing.completion === "0" &&
          (!a.pricing.request || a.pricing.request === "0");
        const bIsFree = b.pricing &&
          b.pricing.prompt === "0" &&
          b.pricing.completion === "0" &&
          (!b.pricing.request || b.pricing.request === "0");

        if (aIsFree && !bIsFree) return -1;
        if (!aIsFree && bIsFree) return 1;
        return (a.name || a.id || '').localeCompare(b.name || b.id || '');
      });

      sortedModels.forEach((model) => {
        const option = document.createElement('option');
        option.value = model.id || model.name;
        const displayName = model.name || model.id || 'Unknown Model';
        const description = model.description ? ` - ${model.description.substring(0, 50)}` : '';

        const isFree = model.pricing &&
          model.pricing.prompt === "0" &&
          model.pricing.completion === "0" &&
          (!model.pricing.request || model.pricing.request === "0");

        const freeLabel = isFree ? ' [FREE]' : '';
        option.textContent = `${displayName}${freeLabel}${description}`;
        modelSelectEl.appendChild(option);
      });
    } else {
      models.forEach((model) => {
        const option = document.createElement('option');
        option.value = model.id || model.name;
        option.textContent = model.name || model.id || 'Unknown Model';
        modelSelectEl.appendChild(option);
      });
    }

    showStatus(`Loaded ${models.length} model(s)`, 'success');
  } catch (error) {
    showStatus('Error loading models: ' + (error instanceof Error ? error.message : String(error)), 'error');
  } finally {
    // Re-enable button
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load Available Models';
    }
  }
}

const DECISION_CATALOG_URL = 'https://openrouter.ai/api/v1/models?output_modalities=decisions';

/** <optgroup> labels of the decision model picker, in display order (spec §7, UX §11 G). */
const DECISION_MODEL_GROUPS: ReadonlyArray<{ status: DecisionModelStatus; label: string }> = [
  { status: 'recommended', label: 'Recommended' },
  { status: 'verified', label: 'Verified with this extension' },
  { status: 'not-recommended', label: 'Works, but not recommended' },
  { status: 'unverified', label: 'Not verified' },
  { status: 'incompatible', label: 'Incompatible (rejects the request)' },
];

/** One option of the decision model picker. */
export interface DecisionModelOption {
  slug: string;
  label: string;
  status: DecisionModelStatus;
}

/**
 * Fills the decision model <select>: the empty prompt option, then one <optgroup> per status (empty groups are
 * not rendered; incompatible models are disabled). `selected` stays selectable even when it is not in `options`
 * (a saved model before the catalog is loaded, or one the catalog no longer lists).
 */
export function renderDecisionModelOptions(
  selectEl: HTMLSelectElement,
  options: readonly DecisionModelOption[],
  selected: string
): void {
  const wanted = selected.trim();
  const all = [...options];
  if (wanted && !all.some((o) => o.slug === wanted)) {
    all.push({ slug: wanted, label: `${wanted} (not in the loaded list)`, status: getDecisionModelStatus(wanted) });
  }

  selectEl.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a decision model...';
  selectEl.appendChild(placeholder);

  for (const group of DECISION_MODEL_GROUPS) {
    const inGroup = all.filter((o) => o.status === group.status);
    if (inGroup.length === 0) continue;
    const groupEl = document.createElement('optgroup');
    groupEl.label = group.label;
    for (const entry of inGroup) {
      const option = document.createElement('option');
      option.value = entry.slug;
      option.textContent = entry.label;
      option.disabled = entry.status === 'incompatible';
      groupEl.appendChild(option);
    }
    selectEl.appendChild(groupEl);
  }
  selectEl.value = wanted;
}

/**
 * Load the pinned decision models from OpenRouter into the select. Resolves the catalog entries, or null when
 * nothing was loaded (no key, error, empty list); the select keeps its list in that case.
 */
export async function loadDecisionModels(
  token: string,
  selectEl: HTMLSelectElement,
  loadBtn?: HTMLButtonElement
): Promise<DecisionCatalogEntry[] | null> {
  if (!token) {
    showStatus('Enter an OpenRouter key first (or use OpenRouter for the explanation model and reuse its key).', 'error');
    return null;
  }

  if (loadBtn) {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Loading...';
  }

  try {
    const response = await fetch(DECISION_CATALOG_URL, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    if (!response.ok) {
      throw new Error(`OpenRouter models API error: ${response.status}`);
    }
    const entries = parseDecisionCatalog(await response.json());
    if (entries.length === 0) {
      showStatus('No decision models found. Check your OpenRouter key.', 'error');
      return null;
    }
    renderDecisionModelOptions(selectEl, entries, selectEl.value);
    showStatus(`Loaded ${entries.length} decision model(s)`, 'success');
    return entries;
  } catch (error) {
    showStatus('Error loading models: ' + (error instanceof Error ? error.message : String(error)), 'error');
    return null;
  } finally {
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Load decision models';
    }
  }
}

/** Fixed sample page of the "Test model" button: public data, no browsing history. */
const TEST_SAMPLE = {
  url: 'https://en.wikipedia.org/wiki/Photosynthesis',
  title: 'Photosynthesis - Wikipedia',
} as const;

type DecisionTestForm = Pick<Settings,
  'decisionApiToken' | 'decisionModel' | 'aiProvider' | 'aiApiToken' | 'aiAudience' | 'categoryItems' | 'safetyLevelItems'>;

/**
 * "Test model": sends one real request built by the production request builder (fixed sample page, the form's
 * audience and lists) through the same fetch path and validator as runtime, without retry and without saving.
 * `passed` is true only for HTTP 200 with a valid answer to every question.
 */
export async function testDecisionModel(form: DecisionTestForm): Promise<{ passed: boolean; text: string }> {
  const request = buildDecisionRequest({
    url: TEST_SAMPLE.url,
    title: TEST_SAMPLE.title,
    audience: form.aiAudience,
    categories: form.categoryItems,
    safetyLevels: form.safetyLevelItems,
    model: form.decisionModel,
  });
  const run = await runDecisionRequest(form, request, { retry: false });
  let result: DecisionTestResult;
  if (run.ok) {
    result = { kind: 'pass', model: run.parsed.model, latencyMs: run.latencyMs };
  } else if (run.kind === 'http') {
    result = { kind: 'http', status: run.status, bodyText: run.bodyText };
  } else if (run.kind === 'invalid') {
    result = { kind: 'invalid', code: run.code };
  } else {
    result = { kind: 'network', message: run.message };
  }
  return { passed: run.ok, text: describeDecisionTestResult(result) };
}
