import type { ClassificationResult } from '../types/index.ts';

export interface RestrictedInfo {
  url: string;
  timestamp: number;
  reason: string;
  matchedPattern: string | null;
  tabId: number;
  suggestedUrl: string | null;
  category: string | null;
  safetyLevel: string | null;
  classificationReason: string | null;
  reasonDetails: string[] | null;
  noUrlReason?: string | null;
  reasonPending?: boolean;
  explanationStatus?: 'pending' | 'done' | 'failed';
}

export function buildReasonDetails(
  reasonCode: string,
  matchedPattern: string | null | undefined,
  c: Pick<ClassificationResult, 'category' | 'safetyLevel' | 'reason'> | null | undefined,
): string[] | null {
  const details: string[] = [];
  if (reasonCode === 'content-restricted' && c) {
    if (c.category) details.push(`Category: ${c.category}`);
    if (c.safetyLevel) details.push(`Safety Level: ${c.safetyLevel}`);
    if (c.reason) details.push(`Reason: ${c.reason}`);
  } else if (reasonCode === 'restricted' && matchedPattern) {
    details.push(`Matches rule: ${matchedPattern}`);
  }
  return details.length > 0 ? details : null;
}

export type RestrictedExplanationOutcome =
  | { url: string; status: 'done'; classification: ClassificationResult }
  | { url: string; status: 'failed' };

export function applyExplanationToRestrictedInfo(info: RestrictedInfo, outcome: RestrictedExplanationOutcome): RestrictedInfo {
  if (info.url !== outcome.url) return info;
  if (outcome.status === 'failed') return { ...info, reasonPending: false, explanationStatus: 'failed' };
  const c = outcome.classification;
  return {
    ...info,
    classificationReason: c.reason,
    suggestedUrl: c.suggestedUrl ?? c.suggestedEducationalResource ?? null,
    noUrlReason: c.noUrlReason ?? null,
    reasonDetails: buildReasonDetails(info.reason, info.matchedPattern, c),
    reasonPending: false,
    explanationStatus: 'done',
  };
}
