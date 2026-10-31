/**
 * Integration with GitHub AI Models API and OpenRouter.ai for content classification
 */

import { Settings, ClassificationResult } from '../types';
import { addSystemLog } from './system-logger';
import { STORAGE_KEYS } from './constants.js';
import { parseModelReply, fallbackClassificationFromText } from '../core/classification.ts';

const GITHUB_MODELS_API_BASE = 'https://models.github.ai';
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

/**
 * Builds system prompt with category and safety level constraints.
 * Model must return ONLY values from the provided lists.
 */
function buildSystemPrompt(availableCategories: string[], availableSafetyLevels: string[]): string {
  const categoriesList =
    availableCategories.length > 0
      ? availableCategories.join(', ')
      : 'Educational, Entertainment, Games, Social Media, Shopping, News, Other';
  const levelsList =
    availableSafetyLevels.length > 0
      ? availableSafetyLevels.join(', ')
      : 'Low, Medium, High, Unknown';

  return (
    `Return JSON: {isEducational: boolean, suggestedUrl: string, noUrlReason: string, category: string, isAgeAppropriate: boolean, safetyLevel: string, reason: string}\n\n` +
    `CRITICAL: category MUST be exactly one of: ${categoriesList}. safetyLevel MUST be exactly one of: ${levelsList}. ` +
    `Do not invent values; use only from these lists. If unsure, use "Other" for category and "Unknown" for safetyLevel.\n` +
    `When category is Educational, suggestedUrl MUST be null (do not suggest a different educational resource).`
  );
}

/**
 * Classifies URL and page title using GitHub AI Models API or OpenRouter.ai
 */
export async function classifyContent(
  url: string, 
  title: string, 
  settings: Settings
): Promise<ClassificationResult | null> {
  if (!settings.enableAIClassification || !settings.aiApiToken) {
    return null;
  }
  
  const provider = settings.aiProvider || 'github';
  
  try {
    // Get user's classification prompt
    let userPrompt = settings.aiClassificationPrompt || 
      "Classify if this URL/title is educational content suitable for children. URL: {url}, Title: {title}.";
    
    // Substitute variables in user prompt
    userPrompt = userPrompt.replace(/{url}/g, url);
    userPrompt = userPrompt.replace(/{title}/g, title || 'No title');

    // Build system prompt with category/safety level lists from settings
    const availableCategories = settings.availableCategories || [];
    const availableSafetyLevels = settings.availableSafetyLevels || [];
    const systemPrompt = buildSystemPrompt(availableCategories, availableSafetyLevels);

    // Combine user prompt with system prompt for JSON format
    const fullPrompt = `${userPrompt}\n\n${systemPrompt}`;
    
    const model = settings.aiModel || 'gpt-4';
    let response: Response;
    let data: any;
    
    if (provider === 'openrouter') {
      // OpenRouter.ai API
      response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.aiApiToken}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': chrome.runtime.getURL(''),
          'X-Title': 'Focus Saving Assistant'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'user',
              content: fullPrompt
            }
          ],
          temperature: 0.3,
          max_tokens: 1000
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('OpenRouter AI API error:', response.status, errorText);
        
        // Try to parse error details from JSON response
        let errorMessage = `OpenRouter AI API error: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error?.message) {
            errorMessage = errorJson.error.message;
            // Include metadata if available
            if (errorJson.error.metadata?.raw) {
              errorMessage += ` - ${errorJson.error.metadata.raw}`;
            }
          }
        } catch (e) {
          // If parsing fails, use the error text as-is
          if (errorText) {
            errorMessage = errorText.length > 200 ? errorText.substring(0, 200) + '...' : errorText;
          }
        }
        
        // Save error to storage for display in settings
        await chrome.storage.local.set({ [STORAGE_KEYS.LAST_AI_ERROR]: errorMessage });
        // Also save to system log
        await addSystemLog('ai', errorMessage, `OpenRouter API error for model: ${model}`);
        
        throw new Error(errorMessage);
      }
      
      data = await response.json();
    } else {
      // GitHub AI Models API
      const apiUrl = `${GITHUB_MODELS_API_BASE}/inference/chat/completions`;
      
      response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${settings.aiApiToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify({
          model: model,
          messages: [
            {
              role: 'user',
              content: fullPrompt
            }
          ],
          temperature: 0.3,
          max_tokens: 1000
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('GitHub AI API error:', response.status, errorText);
        
        // Try to parse error details from JSON response
        let errorMessage = `GitHub AI API error: ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.message) {
            errorMessage = errorJson.message;
          }
        } catch (e) {
          // If parsing fails, use the error text as-is
          if (errorText) {
            errorMessage = errorText.length > 200 ? errorText.substring(0, 200) + '...' : errorText;
          }
        }
        
        // Save error to storage for display in settings
        await chrome.storage.local.set({ [STORAGE_KEYS.LAST_AI_ERROR]: errorMessage });
        // Also save to system log
        await addSystemLog('ai', errorMessage, `GitHub AI API error for model: ${model}`);
        
        throw new Error(errorMessage);
      }
      
      data = await response.json();
    }
    
    // Clear error on successful request
    await chrome.storage.local.remove(STORAGE_KEYS.LAST_AI_ERROR);
    
    // Log full API response for debugging
    const fullResponseStr = JSON.stringify(data, null, 2);
    const responsePreview = fullResponseStr.length > 1000 ? fullResponseStr.substring(0, 1000) + '...' : fullResponseStr;
    await addSystemLog('ai', `AI API response received`, `Model: ${model}, Provider: ${provider}, URL: ${url}\nFull response: ${responsePreview}`);
    
    // Extract JSON from response
    let classification: ClassificationResult | null = null;
    const content = data.choices?.[0]?.message?.content || data.content || '';
    
    // Extract actual model from API response (for OpenRouter, this is the real model used, not the router)
    let actualModel = model; // Default to requested model
    if (provider === 'openrouter' && data.model) {
      // OpenRouter returns the actual model used in response.model
      actualModel = data.model;
    } else if (data.model) {
      // For other providers, use model from response if available
      actualModel = data.model;
    }
    
    // Log extracted content
    if (!content) {
      await addSystemLog('ai', `Warning: Empty content extracted from API response`, `Model: ${model}, Actual Model: ${actualModel}, Provider: ${provider}, URL: ${url}\nData keys: ${Object.keys(data).join(', ')}\nData structure: ${JSON.stringify(data, null, 2).substring(0, 500)}`);
    }
    
    const contentPreview = content.length > 500 ? content.substring(0, 500) + '...' : content;
    await addSystemLog('ai', `AI model response received`, `Requested Model: ${model}, Actual Model: ${actualModel}, URL: ${url}\nContent: ${contentPreview || '(empty)'}`);
    
    // Find JSON in the response and map it to a classification
    const reply = parseModelReply(content, {
      url,
      title,
      model: actualModel, // Use actual model from API response
      now: Date.now(),
      availableCategories: settings.availableCategories || [],
      availableSafetyLevels: settings.availableSafetyLevels || []
    });

    if (reply.kind === 'parsed') {
      classification = reply.classification;

      // Log successfully parsed classification
      await addSystemLog('ai', `Classification parsed successfully`, `Requested Model: ${model}, Actual Model: ${actualModel}, URL: ${url}\nParsed JSON: ${JSON.stringify(reply.parsed, null, 2)}`);
    } else if (reply.kind === 'invalid-json') {
      console.error('Failed to parse classification JSON:', reply.error);
      console.error('JSON string:', reply.jsonString);
      await addSystemLog('ai', `Failed to parse classification JSON: ${reply.error}`, `Model: ${model}, URL: ${url}\nJSON string: ${reply.jsonString}`);
    } else {
      // Log if JSON not found in response
      await addSystemLog('ai', `JSON not found in AI response`, `Model: ${model}, URL: ${url}\nResponse: ${contentPreview}`);
    }

    // If failed to parse JSON, create basic structure
    if (!classification) {
      classification = fallbackClassificationFromText(content, { url, title, model, now: Date.now() });
    }
    
    return classification;
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error classifying content:', errorMessage);
    await addSystemLog('ai', `Classification failed: ${errorMessage}`, `URL: ${url}`);
    return {
      isEducational: null,
      category: 'error',
      reason: errorMessage,
      url: url,
      title: title,
      classifiedAt: Date.now(),
      error: true,
      // Legacy fields for backward compatibility
      educational: null
    };
  }
}

/**
 * Get list of available models from GitHub Models catalog or OpenRouter.ai
 */
export async function getAvailableModels(provider: 'github' | 'openrouter', apiToken: string): Promise<any[]> {
  if (!apiToken) {
    return [];
  }
  
  try {
    if (provider === 'openrouter') {
      // OpenRouter.ai API
      const response = await fetch(`${OPENROUTER_API_BASE}/models`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        return [];
      }
      
      const data = await response.json();
      // OpenRouter returns { data: [...] } format
      return data.data || [];
    } else {
      // GitHub AI Models API
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
        await addSystemLog('ai', `Failed to fetch models: ${response.status} - ${errorText}`, `Provider: ${provider}`);
        return [];
      }
      
      const data = await response.json();
      // GitHub Models API returns an array directly, not wrapped in {models: [...]}
      return Array.isArray(data) ? data : (data.models || []);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('Error fetching models:', errorMessage);
    await addSystemLog('ai', `Failed to fetch models: ${errorMessage}`, `Provider: ${provider}`);
    return [];
  }
}
