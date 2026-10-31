import { isPinnedDecisionModel } from './ai-mode.ts';
import { getDecisionModelStatus, type DecisionModelStatus } from './decision-models.ts';

export interface DecisionCatalogEntry {
  slug: string;
  label: string;
  status: DecisionModelStatus;
  contextLength: number | null;
  promptPricePerMillion: number | null;
  contextLabel: string;
  priceLabel: string;
}

const ORDER: DecisionModelStatus[] = ['recommended', 'verified', 'not-recommended', 'unverified', 'incompatible'];

function formatPrice(perMillion: number | null): string {
  if (perMillion === null) return 'n/a';
  if (perMillion === 0) return 'free';
  return `$${String(Number(perMillion.toFixed(3)))}/M`;
}

function formatContext(n: number | null): string {
  if (n === null) return 'n/a';
  if (n >= 1_000_000) return `${String(Number((n / 1_000_000).toFixed(1)))}M ctx`;
  if (n >= 1000) return `${Math.round(n / 1000)}K ctx`;
  return `${n} ctx`;
}

export function parseDecisionCatalog(json: unknown): DecisionCatalogEntry[] {
  const data = (json as { data?: unknown } | null | undefined)?.data;
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const out: DecisionCatalogEntry[] = [];
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue;
    const m = raw as Record<string, any>;
    const slug = typeof m.canonical_slug === 'string' && m.canonical_slug ? m.canonical_slug : m.id;
    if (typeof slug !== 'string' || !isPinnedDecisionModel(slug) || seen.has(slug)) continue;
    const modalities = m.architecture?.output_modalities;
    if (Array.isArray(modalities) && !modalities.includes('decisions')) continue;
    seen.add(slug);
    const price = Number(m.pricing?.prompt);
    const promptPricePerMillion = m.pricing?.prompt !== undefined && m.pricing?.prompt !== '' && Number.isFinite(price) ? price * 1e6 : null;
    const contextLength = typeof m.context_length === 'number' && Number.isFinite(m.context_length) ? m.context_length : null;
    const status = getDecisionModelStatus(slug);
    const contextLabel = formatContext(contextLength);
    const priceLabel = formatPrice(promptPricePerMillion);
    const check = status === 'recommended' || status === 'verified' || status === 'not-recommended' ? '✓ ' : '';
    out.push({ slug, label: `${check}${slug} · ${contextLabel} · ${priceLabel}`, status, contextLength, promptPricePerMillion, contextLabel, priceLabel });
  }
  return out.sort((a, b) =>
    ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
    (a.promptPricePerMillion ?? Infinity) - (b.promptPricePerMillion ?? Infinity) ||
    a.slug.localeCompare(b.slug));
}
