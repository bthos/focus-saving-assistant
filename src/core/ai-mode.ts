import type { Settings } from '../types/index.ts';

export type AiMode = 'off' | 'single' | 'two-stage';
export type AiModeSettings = Pick<Settings, 'enableAIClassification' | 'aiProvider' | 'aiApiToken' | 'decisionEnabled' | 'decisionApiToken' | 'decisionModel' | 'enableAIExplanation'>;

export function resolveDecisionToken(s: Pick<Settings, 'decisionApiToken' | 'aiProvider' | 'aiApiToken'>): string {
  const own = (s.decisionApiToken ?? '').trim();
  if (own) return own;
  return s.aiProvider === 'openrouter' ? (s.aiApiToken ?? '').trim() : '';
}

export function isPinnedDecisionModel(id: string): boolean {
  const m = (id ?? '').trim();
  return m !== '' && m.includes('/') && !m.startsWith('~') && !m.endsWith('-latest');
}

export function isStage1Configured(s: AiModeSettings): boolean {
  return s.decisionEnabled === true && isPinnedDecisionModel(s.decisionModel) && resolveDecisionToken(s) !== '';
}

export function resolveAiMode(s: AiModeSettings): AiMode {
  if (!s.enableAIClassification) return 'off';
  if (isStage1Configured(s)) return 'two-stage';
  return (s.aiApiToken ?? '').trim() !== '' ? 'single' : 'off';
}

export const isAiClassificationActive = (s: AiModeSettings): boolean => resolveAiMode(s) !== 'off';

export function isStage2Active(s: AiModeSettings): boolean {
  return resolveAiMode(s) === 'two-stage' && s.enableAIExplanation === true && (s.aiApiToken ?? '').trim() !== '';
}
