/**
 * Integration with GitHub AI Models API and OpenRouter.ai for content classification
 * (single-call mode) and for the Stage 2 explanation of a blocked page (two-stage mode).
 */

import { Settings, ClassificationResult } from '../types';
import { addSystemLog } from './system-logger';
import { setLastAiError, clearLastAiError } from './storage';
import { classifyWithDecisionModel } from './decision-classifier';
import { parseModelReply, fallbackClassificationFromText } from '../core/classification.ts';
import { resolveAiMode } from '../core/ai-mode.ts';
import { prefixStageError, type AiStage } from '../core/ai-errors.ts';
import { sanitizeDecisionTitle, sanitizeDecisionUrl } from '../core/decision-request.ts';
import { buildErrorClassification } from '../core/decision-response.ts';
import { buildExplanationPrompt, parseExplanationReply, type ExplanationReply } from '../core/explanation.ts';

const GITHUB_MODELS_API_BASE = 'https://models.github.ai';
const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1';

/**
 * Builds system prompt with category and risk level constraints.
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
      : 'Low, Medium, High';

  const unsureLevelRule = levelsList.split(', ').includes('Unknown')
    ? '"Unknown" for safetyLevel'
    : 'the more cautious (higher risk) item for safetyLevel';
  return (
    `Return JSON: {isEducational: boolean, suggestedUrl: string, noUrlReason: string, category: string, isAgeAppropriate: boolean, safetyLevel: string, reason: string}\n\n` +
    `CRITICAL: category MUST be exactly one of: ${categoriesList}. safetyLevel MUST be exactly one of: ${levelsList}. ` +
    `Do not invent values; use only from these lists. If unsure, use "Other" for category and ${unsureLevelRule}.\n` +
    `When category is Educational, suggestedUrl MUST be null (do not suggest a different educational resource).`
  );
}

export interface ChatCompletionOptions {
  /** Aborts the request (Stage 2 timeout). */
  signal?: AbortSignal;
  /** Set in two-stage mode: error banner texts get the stage prefix and a success clears only that stage's text. */
  stage?: AiStage;
  /** Page URL, for the system log only. */
  logUrl?: string;
}

/** The parts of a chat-completions response body this extension reads (GitHub Models and OpenRouter share them). */
interface ChatCompletionBody {
  choices?: Array<{ message?: { content?: string } }>;
  content?: string;
  model?: string;
}

export interface ChatCompletionResult {
  content: string;
  /** The model the API reports it used (for OpenRouter the real model behind a router), else the requested one. */
  model: string;
}

/**
 * One chat-completions request to the generative model (GitHub Models or OpenRouter), shared by the
 * single-call classifier and the Stage 2 explanation. On an HTTP error it writes the options banner and the
 * system log, then throws Error(message); a network error or abort propagates unchanged.
 */
export async function callChatCompletion(
  settings: Settings,
  prompt: string,
  options: ChatCompletionOptions = {}
): Promise<ChatCompletionResult> {
  const { signal, stage, logUrl = '' } = options;
  const provider = settings.aiProvider || 'github';
  const model = settings.aiModel || 'gpt-4';
  let response: Response;
  let data: ChatCompletionBody;

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
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      }),
      signal
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
      await setLastAiError(prefixStageError(stage, errorMessage));
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
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      }),
      signal
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
      await setLastAiError(prefixStageError(stage, errorMessage));
      // Also save to system log
      await addSystemLog('ai', errorMessage, `GitHub AI API error for model: ${model}`);

      throw new Error(errorMessage);
    }

    data = await response.json();
  }

  // Clear error on successful request
  await clearLastAiError(stage);

  // Log full API response for debugging
  const fullResponseStr = JSON.stringify(data, null, 2);
  const responsePreview = fullResponseStr.length > 1000 ? fullResponseStr.substring(0, 1000) + '...' : fullResponseStr;
  await addSystemLog('ai', `AI API response received`, `Model: ${model}, Provider: ${provider}, URL: ${logUrl}\nFull response: ${responsePreview}`);

  // Extract JSON from response
  const content: string = data.choices?.[0]?.message?.content || data.content || '';

  // Extract actual model from API response (for OpenRouter, this is the real model used, not the router)
  const actualModel: string = data.model || model;

  // Log extracted content
  if (!content) {
    await addSystemLog('ai', `Warning: Empty content extracted from API response`, `Model: ${model}, Actual Model: ${actualModel}, Provider: ${provider}, URL: ${logUrl}\nData keys: ${Object.keys(data).join(', ')}\nData structure: ${JSON.stringify(data, null, 2).substring(0, 500)}`);
  }

  const contentPreview = content.length > 500 ? content.substring(0, 500) + '...' : content;
  await addSystemLog('ai', `AI model response received`, `Requested Model: ${model}, Actual Model: ${actualModel}, URL: ${logUrl}\nContent: ${contentPreview || '(empty)'}`);

  return { content, model: actualModel };
}

/**
 * Single-call mode: classifies URL and page title with the generative model (GitHub AI Models API or OpenRouter.ai).
 * Never throws: a failure is returned as an error classification (fail-open, not cached).
 */
export async function classifyContent(
  url: string, 
  title: string, 
  settings: Settings
): Promise<ClassificationResult> {
  try {
    // Get user's classification prompt
    let userPrompt = settings.aiClassificationPrompt || 
      "Classify if this URL/title is educational content suitable for children. URL: {url}, Title: {title}.";
    
    // Substitute variables in user prompt (replacer functions: "$&" in a title is literal)
    userPrompt = userPrompt.replace(/{url}/g, () => url);
    userPrompt = userPrompt.replace(/{title}/g, () => title || 'No title');
    userPrompt = userPrompt.replace(/{audience}/g, () => settings.aiAudience);

    // Build system prompt with category/risk level lists from settings
    const availableCategories = settings.availableCategories || [];
    const availableSafetyLevels = settings.availableSafetyLevels || [];
    const systemPrompt = buildSystemPrompt(availableCategories, availableSafetyLevels);

    // Combine user prompt with system prompt for JSON format
    const fullPrompt = `${userPrompt}\n\n${systemPrompt}`;
    
    const model = settings.aiModel || 'gpt-4';
    const { content, model: actualModel } = await callChatCompletion(settings, fullPrompt, { logUrl: url });
    const contentPreview = content.length > 500 ? content.substring(0, 500) + '...' : content;
    let classification: ClassificationResult | null = null;
    
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
    return buildErrorClassification(url, title, errorMessage, Date.now());
  }
}

/**
 * Classifies a page according to the AI mode: nothing when AI is off, one generative call in single mode,
 * the decision model in two-stage mode.
 */
export async function classifyPage(
  url: string,
  title: string,
  settings: Settings
): Promise<ClassificationResult | null> {
  switch (resolveAiMode(settings)) {
    case 'two-stage':
      return classifyWithDecisionModel(url, title, settings);
    case 'single':
      return classifyContent(url, title, settings);
    default:
      return null;
  }
}

/** What the Stage 2 call produced: a usable reply, or the reason it failed. */
export type ExplanationRunOutcome =
  | { status: 'done'; reply: ExplanationReply; model: string }
  | { status: 'failed'; error: string };

/**
 * Stage 2: asks the generative model to explain why Stage 1 blocked the page and to suggest an educational
 * page. Never throws; a timeout, HTTP error or unusable reply is returned as `failed`.
 */
export async function explainBlock(
  settings: Settings,
  classification: ClassificationResult,
  options: { signal?: AbortSignal } = {}
): Promise<ExplanationRunOutcome> {
  const url = classification.url ?? '';
  const prompt = buildExplanationPrompt(settings.aiExplanationPrompt, {
    url: sanitizeDecisionUrl(url),
    title: sanitizeDecisionTitle(classification.title),
    audience: settings.aiAudience,
    category: classification.category,
    riskLevel: classification.safetyLevel || 'Unknown',
  });

  try {
    const { content, model } = await callChatCompletion(settings, prompt, {
      signal: options.signal,
      stage: 'explanation',
      logUrl: url,
    });
    const parsed = parseExplanationReply(content);
    if (!parsed.ok) {
      const error = `Explanation reply could not be used (${parsed.code})`;
      await addSystemLog('ai', error, `Model: ${model}, URL: ${url}\nResponse: ${content.substring(0, 500)}`);
      return { status: 'failed', error };
    }
    return {
      status: 'done',
      reply: { reason: parsed.reason, suggestedUrl: parsed.suggestedUrl, noUrlReason: parsed.noUrlReason },
      model,
    };
  } catch (error) {
    const aborted = options.signal?.aborted === true;
    const failure = aborted ? 'Explanation timed out' : error instanceof Error ? error.message : String(error);
    await addSystemLog('ai', `Explanation failed: ${failure}`, `URL: ${url}`);
    return { status: 'failed', error: failure };
  }
}
