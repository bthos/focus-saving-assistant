/**
 * Pure classification logic: parsing a model reply and deciding whether a result is worth caching.
 * No network, storage or logging here; ai-classifier.ts and storage.ts own the side effects.
 */

import type { ClassificationResult } from '../types/index.ts';

/**
 * Normalizes a value to be from the allowed list (exact match, case-insensitive).
 * Returns fallback if not found.
 */
export function normalizeToList(
  value: string,
  allowedList: string[],
  fallback: string
): string {
  const trimmed = (value || '').trim();
  if (!trimmed) return fallback;
  if (allowedList.length === 0) return trimmed;
  const found = allowedList.find(
    (item) => item.trim().toLowerCase() === trimmed.toLowerCase()
  );
  return found ?? fallback;
}

const NO_ALTERNATE_REASON = 'Already educational; no alternate resource suggested.';

/**
 * Clears suggestedUrl when category is Educational — the page is already that resource type.
 */
function clearSuggestedUrlWhenEducationalCategory(c: ClassificationResult): void {
  const cat = (c.category || '').trim().toLowerCase();
  if (cat !== 'educational') {
    return;
  }
  c.suggestedUrl = null;
  c.suggestedEducationalResource = null;
  const existing = (c.noUrlReason || '').trim();
  c.noUrlReason = existing || NO_ALTERNATE_REASON;
}

export interface ModelReplyContext {
  url: string;
  title: string;
  /** Model recorded on the result (the actual model reported by the API, if any). */
  model: string;
  /** Timestamp recorded as classifiedAt. */
  now: number;
  availableCategories: string[];
  availableSafetyLevels: string[];
}

export type ModelReplyParse =
  /** A JSON object was found and mapped to a classification. `parsed` is the raw JSON value (for logging). */
  | { kind: 'parsed'; classification: ClassificationResult; parsed: unknown }
  /** A `{...}` span was found but could not be turned into a classification. */
  | { kind: 'invalid-json'; error: string; jsonString: string }
  /** No balanced `{...}` span in the reply. */
  | { kind: 'no-json' };

/**
 * Finds the first balanced `{...}` span by counting braces (braces inside JSON strings are counted too).
 */
function findJsonObjectBounds(content: string): { start: number; end: number } | null {
  const start = content.indexOf('{');
  if (start === -1) return null;

  // Find the matching closing brace by counting braces
  let braceCount = 0;
  for (let i = start; i < content.length; i++) {
    if (content[i] === '{') braceCount++;
    if (content[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        return { start, end: i + 1 };
      }
    }
  }
  return null;
}

/**
 * Maps the text content of a model reply to a classification.
 */
export function parseModelReply(content: string, ctx: ModelReplyContext): ModelReplyParse {
  const bounds = findJsonObjectBounds(content);
  if (!bounds) {
    return { kind: 'no-json' };
  }

  const jsonString = content.substring(bounds.start, bounds.end);
  try {
    const parsed = JSON.parse(jsonString);
    const category = normalizeToList(
      parsed.category || 'Other',
      ctx.availableCategories,
      'Other'
    );
    const safetyLevel = normalizeToList(
      parsed.safetyLevel || 'Unknown',
      ctx.availableSafetyLevels,
      'Unknown'
    );
    const classification: ClassificationResult = {
      isEducational: parsed.isEducational ?? parsed.educational ?? null,
      category,
      reason: parsed.reason || '',
      isAgeAppropriate: parsed.isAgeAppropriate ?? parsed.ageAppropriate ?? null,
      safetyLevel,
      suggestedUrl: parsed.suggestedUrl ?? parsed.suggestedEducationalResource ?? null,
      noUrlReason: parsed.noUrlReason ?? null,
      url: ctx.url,
      title: ctx.title,
      classifiedAt: ctx.now,
      model: ctx.model,
      // Legacy fields for backward compatibility
      educational: parsed.isEducational ?? parsed.educational ?? null,
      ageAppropriate: parsed.isAgeAppropriate ?? parsed.ageAppropriate ?? null,
      suggestedEducationalResource: parsed.suggestedUrl ?? parsed.suggestedEducationalResource ?? null
    };

    clearSuggestedUrlWhenEducationalCategory(classification);
    return { kind: 'parsed', classification, parsed };
  } catch (e) {
    return { kind: 'invalid-json', error: e instanceof Error ? e.message : String(e), jsonString };
  }
}

/**
 * Classification built from free text when the reply has no usable JSON:
 * educational if the text mentions "educational" or "suitable" (keyword guess).
 */
export function fallbackClassificationFromText(
  content: string,
  ctx: { url: string; title: string; model: string; now: number }
): ClassificationResult {
  const isEducational = content.toLowerCase().includes('educational') ||
                       content.toLowerCase().includes('suitable');
  return {
    isEducational: isEducational,
    category: 'unknown',
    reason: content.substring(0, 200),
    url: ctx.url,
    title: ctx.title,
    classifiedAt: ctx.now,
    model: ctx.model,
    // Legacy fields for backward compatibility
    educational: isEducational
  };
}

/**
 * Check if classification contains useful information worth caching
 * Returns false if all fields are empty, "Not specified", or "unknown"
 */
export function isClassificationUseful(classification: ClassificationResult): boolean {
  const isEducational = classification.isEducational ?? classification.educational ?? null;
  const suggestedUrl = classification.suggestedUrl ?? classification.suggestedEducationalResource ?? null;
  const category = (classification.category || '').trim().toLowerCase();
  const isAgeAppropriate = classification.isAgeAppropriate ?? classification.ageAppropriate ?? null;
  const safetyLevel = (classification.safetyLevel || '').trim().toLowerCase();
  const reason = (classification.reason || '').trim().toLowerCase();

  // Check if there's any meaningful information

  // If isEducational is true, it's definitely useful
  if (isEducational === true) {
    return true;
  }

  // If there's a meaningful suggested URL, it's useful
  if (suggestedUrl && suggestedUrl.trim() !== '' && suggestedUrl.toLowerCase() !== 'not specified') {
    return true;
  }

  // If category is meaningful (not "unknown" or empty or "not specified")
  if (category !== '' && category !== 'unknown' && category !== 'not specified') {
    return true;
  }

  // If isAgeAppropriate is explicitly true or false, it's useful
  if (isAgeAppropriate === true || isAgeAppropriate === false) {
    return true;
  }

  // If safetyLevel is meaningful (not empty/"not specified")
  if (safetyLevel !== '' && safetyLevel !== 'not specified') {
    return true;
  }

  // If reason contains meaningful information (not empty/"not specified")
  if (reason !== '' && reason !== 'not specified') {
    return true;
  }

  // If there's an error, we might want to cache it to avoid retrying
  if (classification.error === true) {
    return true;
  }

  // If isEducational is false BUT we have at least one other meaningful field, it's useful
  if (isEducational === false) {
    // Check if we have any other meaningful information
    const hasOtherInfo =
      (suggestedUrl && suggestedUrl.trim() !== '' && suggestedUrl.toLowerCase() !== 'not specified') ||
      (category !== '' && category !== 'unknown' && category !== 'not specified') ||
      (isAgeAppropriate === true || isAgeAppropriate === false) ||
      (safetyLevel !== '' && safetyLevel !== 'not specified') ||
      (reason !== '' && reason !== 'not specified');

    // Only cache false if there's additional context
    return hasOtherInfo;
  }

  // Otherwise, classification is not useful - don't cache
  return false;
}
