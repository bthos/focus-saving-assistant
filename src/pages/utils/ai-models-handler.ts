/**
 * AI Models handler for loading and managing AI models
 */

import { showStatus } from './form-helpers.js';

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
