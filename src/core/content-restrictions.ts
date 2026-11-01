import type { ClassificationResult } from '../types/index.ts';

export function matchesContentRestrictions(
  classification: ClassificationResult | null | undefined,
  restrictedCategories: string[],
  restrictedSafetyLevels: string[],
): boolean {
  if (!classification) return false;
  if (restrictedCategories && restrictedCategories.length > 0) {
    const category = (classification.category || '').trim().toLowerCase();
    if (category && restrictedCategories.some((r) => r.trim().toLowerCase() === category)) return true;
  }
  if (restrictedSafetyLevels && restrictedSafetyLevels.length > 0) {
    const level = (classification.safetyLevel || '').trim().toLowerCase();
    if (level && restrictedSafetyLevels.some((r) => r.trim().toLowerCase() === level)) return true;
  }
  return false;
}

export function synthesizeReason(
  c: Pick<ClassificationResult, 'category' | 'safetyLevel' | 'isAgeAppropriate' | 'ageAppropriate'>,
  lists: { restrictedCategories: string[]; restrictedSafetyLevels: string[] },
): string {
  const category = c.category || '';
  const level = c.safetyLevel || 'Unknown';
  const catBlocked = matchesContentRestrictions({ category, reason: '' } as ClassificationResult, lists.restrictedCategories, []);
  const levelBlocked = matchesContentRestrictions({ category: '', safetyLevel: level, reason: '' } as ClassificationResult, [], lists.restrictedSafetyLevels);
  if (!catBlocked && !levelBlocked) return `Classified as ${category} (risk level: ${level}).`;
  const parts: string[] = [];
  if (catBlocked) parts.push(`Category "${category}" is blocked in the settings.`);
  if (levelBlocked) parts.push(`Risk level "${level}" is blocked in the settings.`);
  let text = parts.join(' ');
  if ((c.isAgeAppropriate ?? c.ageAppropriate) === false) text += ' The page may not be suitable for the selected age group.';
  return text;
}
