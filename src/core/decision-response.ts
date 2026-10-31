import type { ClassificationResult } from '../types/index.ts';
import { synthesizeReason } from './content-restrictions.ts';
import type { DecisionRequest } from './decision-request.ts';
import { toTriState } from './decision-thresholds.ts';

type ChoiceAnswer = { choice: string; probabilities?: Record<string, number>; confidence?: number };
export interface ParsedDecision {
  model: string;
  cost?: number;
  answers: {
    is_educational: number;
    is_age_appropriate: number;
    category_fits?: number;
    category: ChoiceAnswer;
    safety_level: ChoiceAnswer;
  };
}
export type DecisionParseResult = ({ ok: true } & ParsedDecision) | { ok: false; code: string; message: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isProb = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
const fail = (code: string): { ok: false; code: string; message: string } => ({ ok: false, code, message: `Decision model returned an unusable answer (${code})` });

export function parseDecisionResponse(json: unknown, request: DecisionRequest): DecisionParseResult {
  if (!isObj(json) || !isObj(json.answers)) return fail('missing-answers');
  const answers = json.answers;
  const out: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(request.questions)) {
    const a = answers[id];
    if (a === undefined || a === null) return fail(`missing-answer:${id}`);
    if (!isObj(a) || a.type !== q.type) return fail(`unexpected-type:${id}`);
    if (q.type === 'noul') {
      if (!isProb(a.noul)) return fail(`invalid-answer:${id}`);
      out[id] = a.noul;
    } else {
      if (typeof a.choice !== 'string') return fail(`invalid-answer:${id}`);
      const options = Object.keys(q.criteria);
      const picked = options.find((o) => o === a.choice) ?? options.find((o) => o.toLowerCase() === (a.choice as string).toLowerCase());
      if (!picked) return fail(`invalid-answer:${id}`);
      const choice: ChoiceAnswer = { choice: picked };
      if (isObj(a.probabilities) && Object.values(a.probabilities).every(isProb)) choice.probabilities = a.probabilities as Record<string, number>;
      if (isProb(a.confidence)) choice.confidence = a.confidence;
      out[id] = choice;
    }
  }
  const usage = isObj(json.usage) ? json.usage : {};
  const parsed: ParsedDecision = {
    model: typeof json.model === 'string' ? json.model : request.model,
    answers: out as ParsedDecision['answers'],
  };
  if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) parsed.cost = usage.cost;
  return { ok: true, ...parsed };
}

export interface DecisionMapContext {
  url: string;
  title: string;
  now: number;
  requestedModel: string;
  latencyMs: number;
  restrictedCategories: string[];
  restrictedSafetyLevels: string[];
  explanationActive: boolean;
}

/** Probability of the chosen option: its own entry, else the overall confidence, else null. A numeric check keeps a choice named "constructor" from reading Object.prototype. */
const probOf = (a: ChoiceAnswer): number | null => {
  const own = a.probabilities?.[a.choice];
  return typeof own === 'number' ? own : a.confidence ?? null;
};

export function mapDecisionToClassification(parsed: ParsedDecision, ctx: DecisionMapContext): ClassificationResult {
  const a = parsed.answers;
  const isEducational = toTriState(a.is_educational, parsed.model);
  const isAgeAppropriate = toTriState(a.is_age_appropriate, parsed.model);
  let category = a.category.choice;
  if (a.category_fits !== undefined && toTriState(a.category_fits, parsed.model) === false) category = 'Other';
  const safetyLevel = a.safety_level.choice;
  const educational = category.trim().toLowerCase() === 'educational';
  const c: ClassificationResult = {
    isEducational,
    category,
    reason: synthesizeReason({ category, safetyLevel, isAgeAppropriate }, ctx),
    isAgeAppropriate,
    safetyLevel,
    suggestedUrl: null,
    noUrlReason: educational
      ? 'Already educational; no alternate resource suggested.'
      : ctx.explanationActive ? null : 'Explanation model is not configured.',
    url: ctx.url,
    title: ctx.title,
    classifiedAt: ctx.now,
    model: parsed.model,
    educational: isEducational,
    ageAppropriate: isAgeAppropriate,
    suggestedEducationalResource: null,
    source: 'decision',
    reasonSource: 'synthesized',
    decision: {
      requestedModel: ctx.requestedModel,
      model: parsed.model,
      probabilities: {
        isEducational: a.is_educational,
        isAgeAppropriate: a.is_age_appropriate,
        ...(a.category_fits !== undefined ? { categoryFits: a.category_fits } : {}),
      },
      categoryProbability: probOf(a.category),
      safetyProbability: probOf(a.safety_level),
      latencyMs: ctx.latencyMs,
      ...(parsed.cost !== undefined ? { cost: parsed.cost } : {}),
    },
  };
  return c;
}

function serverMessage(bodyText: string): string {
  const text = (bodyText ?? '').trim();
  if (!text) return '';
  try {
    const j = JSON.parse(text);
    const m = j?.error?.message;
    if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 200);
  } catch { /* plain body */ }
  return text.slice(0, 200);
}

export function describeDecisionHttpError(status: number, bodyText: string): string {
  const base =
    status === 400 ? 'Decision model did not accept the request'
    : status === 401 ? 'OpenRouter rejected the API key'
    : status === 402 ? 'OpenRouter account has insufficient credits'
    : status === 429 ? 'OpenRouter rate limit reached'
    : status >= 500 ? `OpenRouter Decisions service error (${status})`
    : `OpenRouter Decisions API error: ${status}`;
  const msg = serverMessage(bodyText);
  return msg ? `${base}: ${msg}` : base;
}

export function buildErrorClassification(url: string, title: string, message: string, now: number): ClassificationResult {
  return { isEducational: null, category: 'error', reason: message, url, title, classifiedAt: now, error: true, educational: null };
}
