/**
 * Loader for tests/core/fixtures/decision-response.json: five real POST /api/v1/systemone responses
 * recorded by the 2026-10-31 probe (Jev educational example + one adversarial example per model).
 */

import { readFileSync } from 'node:fs';

import { DEFAULT_CATEGORY_ITEMS, DEFAULT_SAFETY_LEVEL_ITEMS } from '../../../src/core/classification-defaults.ts';
import { buildDecisionRequest, type DecisionRequest } from '../../../src/core/decision-request.ts';

export interface FixtureAnswer {
  type: string;
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
}

export interface DecisionFixtureCase {
  id: string;
  model: string;
  kind: 'educational' | 'adversarial';
  page_url: string;
  page_title: string;
  audience: string;
  response: {
    model: string;
    answers: Record<string, FixtureAnswer>;
    usage: { input_tokens: number; output_tokens: number; cost: number };
  };
}

export const decisionFixture = JSON.parse(
  readFileSync(new URL('../fixtures/decision-response.json', import.meta.url), 'utf8'),
) as { audience: string; cases: DecisionFixtureCase[] };

/** The request the probe sent: default option lists, so category_fits is omitted (the list contains Other). */
export function probeRequest(c: DecisionFixtureCase): DecisionRequest {
  return buildDecisionRequest({
    url: c.page_url,
    title: c.page_title,
    audience: c.audience,
    categories: DEFAULT_CATEGORY_ITEMS,
    safetyLevels: DEFAULT_SAFETY_LEVEL_ITEMS,
    model: c.model,
  });
}
