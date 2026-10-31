export const DECISION_YES_MIN = 0.7;
export const DECISION_NO_MAX = 0.3;
export const DECISION_THRESHOLD_OVERRIDES: Record<string, { yesMin: number; noMax: number }> = {};

export function toTriState(p: number, model?: string): boolean | null {
  const o = model ? DECISION_THRESHOLD_OVERRIDES[model] : undefined;
  const yes = o?.yesMin ?? DECISION_YES_MIN;
  const no = o?.noMax ?? DECISION_NO_MAX;
  if (p >= yes) return true;
  if (p <= no) return false;
  return null;
}
