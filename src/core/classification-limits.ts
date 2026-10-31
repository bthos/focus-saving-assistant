import { DEFAULT_CATEGORY_ITEMS, DEFAULT_SAFETY_LEVEL_ITEMS, type ClassificationItem } from './classification-defaults.ts';

export const MAX_CATEGORY_ITEMS = 40;
export const MAX_SAFETY_LEVEL_ITEMS = 10;
export const ITEM_NAME_MIN = 1;
export const ITEM_NAME_MAX = 40;
export const ITEM_DESCRIPTION_MAX = 200;
export type ItemKind = 'category' | 'safety';

const maxFor = (kind: ItemKind): number => (kind === 'category' ? MAX_CATEGORY_ITEMS : MAX_SAFETY_LEVEL_ITEMS);

export function cleanItemName(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
}

export function sanitizeItemDescription(raw: string): string {
  return cleanItemName(raw).slice(0, ITEM_DESCRIPTION_MAX);
}

export function validateNewItem(raw: string, existingNames: readonly string[], kind: ItemKind, currentCount: number):
  { ok: true; name: string } | { ok: false; code: 'empty' | 'too-long' | 'duplicate' | 'limit' } {
  const name = cleanItemName(raw);
  if (name.length < ITEM_NAME_MIN) return { ok: false, code: 'empty' };
  if (name.length > ITEM_NAME_MAX) return { ok: false, code: 'too-long' };
  if (existingNames.some((n) => n.trim().toLowerCase() === name.toLowerCase())) return { ok: false, code: 'duplicate' };
  if (currentCount >= maxFor(kind)) return { ok: false, code: 'limit' };
  return { ok: true, name };
}

export function normalizeClassificationItems(items: readonly unknown[]): ClassificationItem[] {
  const seen = new Set<string>();
  const out: ClassificationItem[] = [];
  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.name !== 'string') continue;
    const name = cleanItemName(r.name);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const item: ClassificationItem = { name, restricted: typeof r.restricted === 'boolean' ? r.restricted : true };
    if (typeof r.description === 'string') {
      const d = sanitizeItemDescription(r.description);
      if (d) item.description = d;
    }
    out.push(item);
  }
  return out;
}

export function selectItemsForModel(items: readonly ClassificationItem[], kind: ItemKind): ClassificationItem[] {
  const seen = new Set<string>();
  const out: ClassificationItem[] = [];
  for (const item of items) {
    const name = cleanItemName(item.name ?? '');
    if (name.length < ITEM_NAME_MIN || name.length > ITEM_NAME_MAX || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push({ ...item, name });
    if (out.length >= maxFor(kind)) break;
  }
  if (out.length === 0) return (kind === 'category' ? DEFAULT_CATEGORY_ITEMS : DEFAULT_SAFETY_LEVEL_ITEMS).map((i) => ({ ...i }));
  return out;
}

export function getClassificationLimitWarnings(items: readonly ClassificationItem[], kind: ItemKind): string[] {
  const warnings: string[] = [];
  const noun = kind === 'category' ? 'categories' : 'safety levels';
  const singular = kind === 'category' ? 'category' : 'safety level';
  const max = maxFor(kind);
  if (items.length > max) {
    warnings.push(`You have ${items.length} ${noun}. Only the first ${max} are sent to the decision model; the rest are ignored and will not block anything. Remove some or move them up.`);
  }
  const long = items.filter((i) => cleanItemName(i.name ?? '').length > ITEM_NAME_MAX).length;
  if (long > 0) {
    warnings.push(long === 1
      ? `1 ${singular} name is longer than ${ITEM_NAME_MAX} characters and is ignored.`
      : `${long} ${singular} names are longer than ${ITEM_NAME_MAX} characters and are ignored.`);
  }
  return warnings;
}
