import type { Settings } from '../types/index.ts';
import { isPinnedDecisionModel, resolveDecisionToken } from './ai-mode.ts';
import { describeDecisionHttpError } from './decision-response.ts';

export type DecisionModelStatus = 'recommended' | 'verified' | 'not-recommended' | 'unverified' | 'incompatible';

/** Exact pinned slugs only (thresholds belong to the probed build). A Map, not a Record: lookups take user-supplied keys, so `constructor`/`__proto__` must not resolve. */
export const VERIFIED_DECISION_MODELS: ReadonlyMap<string, 'recommended' | 'verified' | 'not-recommended'> = new Map<string, 'recommended' | 'verified' | 'not-recommended'>([
  ['typesafe/jev-1.14-20261014', 'recommended'],
  ['perplexity/pplx-decider-flash-v1.2-20261016', 'verified'],
  ['liquid/d1.1-20261027', 'verified'],
  ['baseten/joey-1-20261029', 'not-recommended'],
]);

export function getDecisionModelStatus(slug: string): DecisionModelStatus {
  const s = (slug ?? '').trim();
  const verified = VERIFIED_DECISION_MODELS.get(s);
  if (verified) return verified;
  if (s.toLowerCase().startsWith('respan/')) return 'incompatible';
  return 'unverified';
}

export function isVerifiedDecisionModel(slug: string): boolean {
  return VERIFIED_DECISION_MODELS.has((slug ?? '').trim());
}

export function needsModelTest(slug: string, testedOk: ReadonlySet<string>): boolean {
  return getDecisionModelStatus(slug) === 'unverified' && !testedOk.has(slug);
}

export type DecisionSettingsError = {
  field: 'decisionApiToken' | 'decisionModel';
  code: 'missing-token' | 'not-pinned' | 'incompatible' | 'needs-test';
  message: string;
};

export function validateDecisionSettings(
  form: Pick<Settings, 'decisionEnabled' | 'decisionApiToken' | 'decisionModel' | 'aiProvider' | 'aiApiToken'>,
  testedOk: ReadonlySet<string>,
): DecisionSettingsError | null {
  if (!form.decisionEnabled) return null;
  if (resolveDecisionToken(form) === '') {
    return { field: 'decisionApiToken', code: 'missing-token', message: 'Enter an OpenRouter key for the decision model, or use OpenRouter for the explanation model and reuse its key.' };
  }
  if (!isPinnedDecisionModel(form.decisionModel)) {
    return { field: 'decisionModel', code: 'not-pinned', message: 'Choose a pinned decision model (an id like liquid/d1.1-20261027). Aliases such as ~vendor/model or ids ending in -latest are not accepted.' };
  }
  const slug = form.decisionModel.trim();
  if (getDecisionModelStatus(slug) === 'incompatible') {
    return { field: 'decisionModel', code: 'incompatible', message: 'This model does not accept the request and cannot be used.' };
  }
  if (needsModelTest(slug, testedOk)) {
    return { field: 'decisionModel', code: 'needs-test', message: 'This model has not been verified with this extension. Press "Test model" and wait for a pass, or choose a model marked ✓.' };
  }
  return null;
}

export type DecisionTestResult =
  | { kind: 'pass'; model: string; latencyMs: number }
  | { kind: 'http'; status: number; bodyText: string }
  | { kind: 'invalid'; code: string }
  | { kind: 'network'; message: string };

export function describeDecisionTestResult(r: DecisionTestResult): string {
  switch (r.kind) {
    case 'pass': return `Test passed: ${r.model} answered in ${r.latencyMs} ms.`;
    case 'http': return `Test failed: ${describeDecisionHttpError(r.status, r.bodyText)}`;
    case 'invalid': return `Test failed: unexpected answer (${r.code})`;
    default: return `Test failed: ${r.message}`;
  }
}
