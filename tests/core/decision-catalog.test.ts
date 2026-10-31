import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { parseDecisionCatalog } from '../../src/core/decision-catalog.ts';

interface RawModel {
  id?: string;
  canonical_slug?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { output_modalities?: string[] };
  name?: string;
}

const catalog = (...models: RawModel[]): { data: RawModel[] } => ({ data: models });
const slugs = (json: unknown): string[] => parseDecisionCatalog(json).map((e) => e.slug);

describe('parseDecisionCatalog — filtering', () => {
  it('drops aliases: ~vendor ids and ids ending in -latest', () => {
    const out = slugs(
      catalog(
        { id: '~liquid/d1.1-latest' },
        { id: 'liquid/d1.1-latest' },
        { id: 'liquid/d1.1-20261027' },
      ),
    );
    assert.deepEqual(out, ['liquid/d1.1-20261027']);
  });

  it('drops entries without any slug or with a non-object shape', () => {
    const out = slugs(catalog({}, { name: 'no id' }, { id: '' }, { id: 'nomodel' }, { id: 'liquid/d1.1-20261027' }, null as never, 'x' as never));
    assert.deepEqual(out, ['liquid/d1.1-20261027']);
  });

  it('prefers canonical_slug over id, and checks the pinned rule on the slug it chose', () => {
    const out = slugs(
      catalog(
        { id: '~typesafe/jev-latest', canonical_slug: 'typesafe/jev-1.14-20261014' },
        { id: 'liquid/d1.1-20261027', canonical_slug: 'liquid/d1.1-latest' },
      ),
    );
    assert.deepEqual(out, ['typesafe/jev-1.14-20261014']);
  });

  it('drops entries that declare output modalities without decisions; keeps entries that list decisions or declare nothing', () => {
    const out = slugs(
      catalog(
        { id: 'a/chat-1', architecture: { output_modalities: ['text'] } },
        { id: 'b/dec-1', architecture: { output_modalities: ['decisions'] } },
        { id: 'c/unknown-1' },
      ),
    );
    assert.deepEqual(out.sort(), ['b/dec-1', 'c/unknown-1']);
  });

  it('collapses duplicate slugs to one entry, the first wins', () => {
    const out = parseDecisionCatalog(
      catalog(
        { id: 'liquid/d1.1-20261027', pricing: { prompt: '0.000000042' } },
        { id: '~liquid/d1.1', canonical_slug: 'liquid/d1.1-20261027', pricing: { prompt: '0.000009' } },
      ),
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].priceLabel, '$0.042/M');
  });

  it('non-object input gives an empty list and never throws', () => {
    for (const bad of [null, undefined, 'x', 5, [], {}, { data: 'x' }, { data: null }, { data: {} }]) {
      assert.deepEqual(parseDecisionCatalog(bad), [], JSON.stringify(bad));
    }
  });
});

describe('parseDecisionCatalog — entry fields', () => {
  it('formats the prompt price per million tokens: 0.000000042 -> $0.042/M', () => {
    const [e] = parseDecisionCatalog(catalog({ id: 'liquid/d1.1-20261027', pricing: { prompt: '0.000000042' } }));
    assert.equal(e.priceLabel, '$0.042/M');
    assert.ok(Math.abs((e.promptPricePerMillion ?? NaN) - 0.042) < 1e-9);
  });

  it('other prices: no trailing zeros, free for zero', () => {
    const entries = parseDecisionCatalog(
      catalog(
        { id: 'a/m-1', pricing: { prompt: '0.0000015' } },
        { id: 'b/m-2', pricing: { prompt: '0.000003' } },
        { id: 'c/m-3', pricing: { prompt: '0' } },
      ),
    );
    const byId = new Map(entries.map((e) => [e.slug, e]));
    assert.equal(byId.get('a/m-1')?.priceLabel, '$1.5/M');
    assert.equal(byId.get('b/m-2')?.priceLabel, '$3/M');
    assert.equal(byId.get('c/m-3')?.priceLabel, 'free');
  });

  it('context length is shown in K', () => {
    const [e] = parseDecisionCatalog(catalog({ id: 'liquid/d1.1-20261027', context_length: 262144 }));
    assert.equal(e.contextLength, 262144);
    assert.equal(e.contextLabel, '262K ctx');
  });

  it('missing pricing and context render n/a without throwing', () => {
    const [e] = parseDecisionCatalog(catalog({ id: 'liquid/d1.1-20261027' }));
    assert.equal(e.priceLabel, 'n/a');
    assert.equal(e.contextLabel, 'n/a');
    assert.equal(e.promptPricePerMillion, null);
    assert.equal(e.contextLength, null);
    assert.ok(e.label.includes('n/a'));
  });

  it('unusable pricing and context values also render n/a', () => {
    const [e] = parseDecisionCatalog(
      catalog({ id: 'liquid/d1.1-20261027', context_length: 'big' as never, pricing: { prompt: 'cheap' } }),
    );
    assert.equal(e.priceLabel, 'n/a');
    assert.equal(e.contextLabel, 'n/a');
  });

  it('each entry carries its compatibility status', () => {
    const byId = new Map(
      parseDecisionCatalog(
        catalog(
          { id: 'typesafe/jev-1.14-20261014' },
          { id: 'perplexity/pplx-decider-flash-v1.2-20261016' },
          { id: 'liquid/d1.1-20261027' },
          { id: 'baseten/joey-1-20261029' },
          { id: 'respan/span-01-lite:free' },
          { id: 'someone/else-1' },
        ),
      ).map((e) => [e.slug, e.status]),
    );
    assert.equal(byId.get('typesafe/jev-1.14-20261014'), 'recommended');
    assert.equal(byId.get('perplexity/pplx-decider-flash-v1.2-20261016'), 'verified');
    assert.equal(byId.get('liquid/d1.1-20261027'), 'verified');
    assert.equal(byId.get('baseten/joey-1-20261029'), 'not-recommended');
    assert.equal(byId.get('respan/span-01-lite:free'), 'incompatible');
    assert.equal(byId.get('someone/else-1'), 'unverified');
  });

  it('the label starts with a check mark for recommended, verified and not-recommended models only', () => {
    const byId = new Map(
      parseDecisionCatalog(
        catalog(
          { id: 'typesafe/jev-1.14-20261014', context_length: 262144, pricing: { prompt: '0.000000042' } },
          { id: 'baseten/joey-1-20261029' },
          { id: 'someone/else-1' },
          { id: 'respan/span-01-lite:free' },
        ),
      ).map((e) => [e.slug, e.label]),
    );
    assert.equal(byId.get('typesafe/jev-1.14-20261014'), '✓ typesafe/jev-1.14-20261014 · 262K ctx · $0.042/M');
    assert.ok(byId.get('baseten/joey-1-20261029')?.startsWith('✓ '));
    assert.equal(byId.get('someone/else-1')?.startsWith('✓'), false);
    assert.equal(byId.get('respan/span-01-lite:free')?.startsWith('✓'), false);
    assert.ok(byId.get('someone/else-1')?.startsWith('someone/else-1 · '));
  });
});

describe('parseDecisionCatalog — order', () => {
  it('status order, then price ascending, then slug', () => {
    const out = slugs(
      catalog(
        { id: 'zz/unverified-1', pricing: { prompt: '0.000001' } },
        { id: 'aa/unverified-2', pricing: { prompt: '0.000002' } },
        { id: 'bb/unverified-3', pricing: { prompt: '0.000001' } },
        { id: 'respan/span-01-lite:free', pricing: { prompt: '0' } },
        { id: 'baseten/joey-1-20261029', pricing: { prompt: '0.00000001' } },
        { id: 'perplexity/pplx-decider-flash-v1.2-20261016', pricing: { prompt: '0.00000002' } },
        { id: 'liquid/d1.1-20261027', pricing: { prompt: '0.00000001' } },
        { id: 'typesafe/jev-1.14-20261014', pricing: { prompt: '0.00000005' } },
      ),
    );
    assert.deepEqual(out, [
      'typesafe/jev-1.14-20261014', // recommended
      'liquid/d1.1-20261027', // verified, cheaper than pplx
      'perplexity/pplx-decider-flash-v1.2-20261016',
      'baseten/joey-1-20261029', // not recommended
      'bb/unverified-3', // unverified: price 1 then slug (bb < zz)
      'zz/unverified-1',
      'aa/unverified-2', // price 2
      'respan/span-01-lite:free', // incompatible last, although free
    ]);
  });

  it('entries without a price sort after priced ones of the same status', () => {
    const out = slugs(
      catalog(
        { id: 'aa/no-price-1' },
        { id: 'zz/priced-1', pricing: { prompt: '0.000009' } },
      ),
    );
    assert.deepEqual(out, ['zz/priced-1', 'aa/no-price-1']);
  });
});
