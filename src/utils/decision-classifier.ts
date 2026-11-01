/**
 * Stage 1: fast verdict from an OpenRouter Decisions model (POST /api/v1/systemone).
 * The model only judges (educational? age-appropriate? which category? which risk level?);
 * pure code in core/ builds the request, validates the answer and maps it to a classification.
 */

import type { Settings, ClassificationResult } from '../types';
import { addSystemLog } from './system-logger.js';
import { setLastAiError, clearLastAiError } from './storage.js';
import { prefixStageError } from '../core/ai-errors.ts';
import { isStage2Active, resolveDecisionToken } from '../core/ai-mode.ts';
import {
  buildDecisionRequest,
  DECISION_ENDPOINT,
  DECISION_RETRY_DELAY_MS,
  DECISION_TIMEOUT_MS,
  type DecisionRequest,
} from '../core/decision-request.ts';
import {
  buildErrorClassification,
  describeDecisionHttpError,
  mapDecisionToClassification,
  parseDecisionResponse,
  type ParsedDecision,
} from '../core/decision-response.ts';

/** Outcome of one decision call; `kind` tells the options "Test model" button which sentence to show. */
export type DecisionRunResult =
  | { ok: true; parsed: ParsedDecision; latencyMs: number; rawJson: unknown }
  | { ok: false; kind: 'http'; status: number; bodyText: string }
  | { ok: false; kind: 'invalid'; code: string; message: string }
  | { ok: false; kind: 'network'; message: string };

type DecisionTokenSettings = Pick<Settings, 'decisionApiToken' | 'aiProvider' | 'aiApiToken'>;

/** One attempt: HTTP call with a timeout, then validation of the answers against the request. */
async function attemptDecisionRequest(token: string, request: DecisionRequest): Promise<DecisionRunResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DECISION_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await fetch(DECISION_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': chrome.runtime.getURL(''),
        'X-Title': 'Focus Saving Assistant'
      },
      body: JSON.stringify(request),
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, kind: 'http', status: response.status, bodyText: await response.text().catch(() => '') };
    }
    let rawJson: unknown;
    try {
      rawJson = await response.json();
    } catch (error) {
      // A timeout while reading the body is a network problem (retried); a body that is not JSON is not.
      if (controller.signal.aborted) throw error;
      const code = 'not-json';
      return { ok: false, kind: 'invalid', code, message: `Decision model returned an unusable answer (${code})` };
    }
    const latencyMs = Date.now() - startedAt;
    const parsed = parseDecisionResponse(rawJson, request);
    if (!parsed.ok) {
      return { ok: false, kind: 'invalid', code: parsed.code, message: parsed.message };
    }
    return { ok: true, parsed, latencyMs, rawJson };
  } catch (error) {
    const timedOut = controller.signal.aborted;
    const message = timedOut
      ? `Decision model did not answer within ${DECISION_TIMEOUT_MS / 1000} s`
      : error instanceof Error ? error.message : String(error);
    return { ok: false, kind: 'network', message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends the request with the resolved OpenRouter key. Network errors, timeouts and HTTP 5xx are retried once
 * after DECISION_RETRY_DELAY_MS; 4xx (including 429) and unusable answers never are. The options "Test model"
 * button passes `retry: false` so a failing model reports at once.
 */
export async function runDecisionRequest(
  settings: DecisionTokenSettings,
  request: DecisionRequest,
  options: { retry?: boolean } = {}
): Promise<DecisionRunResult> {
  const token = resolveDecisionToken(settings);
  const retriable = (r: DecisionRunResult): boolean =>
    !r.ok && (r.kind === 'network' || (r.kind === 'http' && r.status >= 500));

  let result = await attemptDecisionRequest(token, request);
  if ((options.retry ?? true) && retriable(result)) {
    await new Promise((resolve) => setTimeout(resolve, DECISION_RETRY_DELAY_MS));
    result = await attemptDecisionRequest(token, request);
  }
  return result;
}

/**
 * Classifies one page with the decision model. Never throws: a failure is returned in the existing error shape
 * (fail-open, not cached, retried on the next navigation) after writing the stage-prefixed options banner.
 */
export async function classifyWithDecisionModel(
  url: string,
  title: string,
  settings: Settings
): Promise<ClassificationResult> {
  const request = buildDecisionRequest({
    url,
    title,
    audience: settings.aiAudience,
    categories: settings.categoryItems,
    safetyLevels: settings.safetyLevelItems,
    model: settings.decisionModel,
  });

  try {
    const run = await runDecisionRequest(settings, request);

    if (!run.ok) {
      const rawMessage =
        run.kind === 'http' ? describeDecisionHttpError(run.status, run.bodyText) : run.message;
      const message = prefixStageError('decision', rawMessage);
      await setLastAiError(message);
      await addSystemLog('ai', message, `Decision request failed. Model: ${request.model}, URL: ${url}`);
      return buildErrorClassification(url, title, message, Date.now());
    }

    await clearLastAiError('decision');
    const classification = mapDecisionToClassification(run.parsed, {
      url,
      title,
      now: Date.now(),
      requestedModel: request.model,
      latencyMs: run.latencyMs,
      restrictedCategories: settings.restrictedCategories ?? [],
      restrictedSafetyLevels: settings.restrictedSafetyLevels ?? [],
      explanationActive: isStage2Active(settings),
    });
    await addSystemLog(
      'ai',
      'Decision model answered',
      `Requested model: ${request.model}, Response model: ${run.parsed.model}, Latency: ${run.latencyMs} ms, Cost: ${run.parsed.cost ?? 'n/a'}, URL: ${url}\nAnswers: ${JSON.stringify(run.parsed.answers)}`
    );
    return classification;
  } catch (error) {
    // Defensive: the pure steps do not throw, but storage or logging might.
    const message = prefixStageError('decision', error instanceof Error ? error.message : String(error));
    console.error('Error classifying content with the decision model:', message);
    return buildErrorClassification(url, title, message, Date.now());
  }
}
