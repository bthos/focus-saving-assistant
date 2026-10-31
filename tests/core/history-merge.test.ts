import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  mergeHistoryEntries,
  mergeVisits,
  upsertHistoryEntry,
  type NewHistoryEntry,
} from '../../src/core/history-merge.ts';
import type { HistoryEntry, VisitInfo } from '../../src/types/index.ts';

function visit(visitTime: number, transition = 'link'): VisitInfo {
  return { visitTime, transition };
}

function entry(overrides: Partial<HistoryEntry> & { url: string }): HistoryEntry {
  return { id: 1, title: 'Title', timestamp: 1000, restricted: false, ...overrides };
}

describe('mergeVisits', () => {
  it('sorts by visitTime ascending', () => {
    const merged = mergeVisits([visit(30), visit(10)], [visit(20)]);
    assert.deepEqual(merged.map((v) => v.visitTime), [10, 20, 30]);
  });

  it('drops duplicates by visitTime and keeps the one that was listed first', () => {
    const merged = mergeVisits([visit(10, 'link')], [visit(10, 'typed'), visit(5)]);
    assert.deepEqual(merged, [visit(5), visit(10, 'link')]);
  });

  it('does not mutate its inputs', () => {
    const a = [visit(2)];
    const b = [visit(1)];
    mergeVisits(a, b);
    assert.deepEqual(a, [visit(2)]);
    assert.deepEqual(b, [visit(1)]);
  });
});

describe('mergeHistoryEntries', () => {
  it('adds entries for new URLs and returns everything newest first', () => {
    const merged = mergeHistoryEntries(
      [entry({ url: 'https://a.test/', timestamp: 100 })],
      [entry({ url: 'https://b.test/', timestamp: 300 }), entry({ url: 'https://c.test/', timestamp: 200 })]
    );
    assert.deepEqual(merged.map((e) => e.url), ['https://b.test/', 'https://c.test/', 'https://a.test/']);
  });

  it('same URL: unions visits, drops duplicate visit times, recounts', () => {
    const merged = mergeHistoryEntries(
      [entry({ url: 'https://a.test/', visits: [visit(1), visit(2)], visitCount: 2 })],
      [entry({ url: 'https://a.test/', visits: [visit(2), visit(3)], visitCount: 2 })]
    );
    assert.equal(merged.length, 1);
    assert.deepEqual(merged[0].visits?.map((v) => v.visitTime), [1, 2, 3]);
    assert.equal(merged[0].visitCount, 3);
  });

  it('same URL: a newer entry updates timestamp and title', () => {
    const [merged] = mergeHistoryEntries(
      [entry({ url: 'https://a.test/', title: 'Old', timestamp: 100 })],
      [entry({ url: 'https://a.test/', title: 'New', timestamp: 200 })]
    );
    assert.equal(merged.title, 'New');
    assert.equal(merged.timestamp, 200);
  });

  it('same URL: an older entry leaves timestamp and title alone', () => {
    const [merged] = mergeHistoryEntries(
      [entry({ url: 'https://a.test/', title: 'Current', timestamp: 200 })],
      [entry({ url: 'https://a.test/', title: 'Stale', timestamp: 100 })]
    );
    assert.equal(merged.title, 'Current');
    assert.equal(merged.timestamp, 200);
  });

  it('same URL: restricted flag and classification of the existing entry are kept', () => {
    const [merged] = mergeHistoryEntries(
      [entry({ url: 'https://a.test/', restricted: true, reason: 'restricted' })],
      [entry({ url: 'https://a.test/', restricted: false, reason: 'permitted' })]
    );
    assert.equal(merged.restricted, true);
    assert.equal(merged.reason, 'restricted');
  });

  it('current behaviour: incoming visits are dropped when the existing entry has no visits', () => {
    const [merged] = mergeHistoryEntries(
      [entry({ url: 'https://a.test/' })],
      [entry({ url: 'https://a.test/', visits: [visit(1)], visitCount: 1 })]
    );
    assert.equal(merged.visits, undefined);
    assert.equal(merged.visitCount, undefined);
  });
});

describe('upsertHistoryEntry', () => {
  const NOW = 5000;
  const NEW_ID = 42.5;

  function upsert(history: HistoryEntry[], input: NewHistoryEntry) {
    return upsertHistoryEntry(history, input, NOW, NEW_ID);
  }

  describe('URL not in history yet', () => {
    it('prepends a new entry with the given id and "now" as the default timestamp', () => {
      const existing = entry({ url: 'https://a.test/' });
      const { history, entry: added } = upsert([existing], { url: 'https://b.test/', title: 'B', restricted: false });
      assert.deepEqual(history.map((e) => e.url), ['https://b.test/', 'https://a.test/']);
      assert.equal(added.id, NEW_ID);
      assert.equal(added.timestamp, NOW);
      assert.equal(history[0], added);
    });

    it('uses the entry timestamp when one is given', () => {
      const { entry: added } = upsert([], { url: 'https://b.test/', title: 'B', restricted: false, timestamp: 77 });
      assert.equal(added.timestamp, 77);
    });
  });

  describe('URL already in history', () => {
    it('moves the entry to the top without duplicating it', () => {
      const history = [entry({ url: 'https://a.test/' }), entry({ url: 'https://b.test/' }), entry({ url: 'https://c.test/' })];
      const result = upsert(history, { url: 'https://b.test/', title: 'B', restricted: false });
      assert.deepEqual(result.history.map((e) => e.url), ['https://b.test/', 'https://a.test/', 'https://c.test/']);
      assert.equal(result.history[0], result.entry);
    });

    it('keeps the original id', () => {
      const { entry: updated } = upsert([entry({ url: 'https://a.test/', id: 9 })], { url: 'https://a.test/', title: 'A', restricted: false });
      assert.equal(updated.id, 9);
    });

    it('newest title wins: a later timestamp replaces title and timestamp', () => {
      const { entry: updated } = upsert(
        [entry({ url: 'https://a.test/', title: 'Old', timestamp: 100 })],
        { url: 'https://a.test/', title: 'New', restricted: false, timestamp: 200 }
      );
      assert.equal(updated.title, 'New');
      assert.equal(updated.timestamp, 200);
    });

    it('newest title wins: without a timestamp, "now" counts as newer', () => {
      const { entry: updated } = upsert(
        [entry({ url: 'https://a.test/', title: 'Old', timestamp: 100 })],
        { url: 'https://a.test/', title: 'New', restricted: false }
      );
      assert.equal(updated.title, 'New');
      assert.equal(updated.timestamp, NOW);
    });

    it('an older timestamp keeps the existing title and timestamp', () => {
      const { entry: updated } = upsert(
        [entry({ url: 'https://a.test/', title: 'Current', timestamp: 200 })],
        { url: 'https://a.test/', title: 'Stale', restricted: false, timestamp: 100 }
      );
      assert.equal(updated.title, 'Current');
      assert.equal(updated.timestamp, 200);
    });

    it('restricted never reverts to false', () => {
      const { entry: updated } = upsert(
        [entry({ url: 'https://a.test/', restricted: true })],
        { url: 'https://a.test/', title: 'A', restricted: false }
      );
      assert.equal(updated.restricted, true);
    });

    it('restricted can turn true', () => {
      const { entry: updated } = upsert(
        [entry({ url: 'https://a.test/', restricted: false })],
        { url: 'https://a.test/', title: 'A', restricted: true }
      );
      assert.equal(updated.restricted, true);
    });

    it('merges visits, drops duplicate visit times, recounts', () => {
      const { entry: updated } = upsert(
        [entry({ url: 'https://a.test/', visits: [visit(1), visit(3)], visitCount: 2 })],
        { url: 'https://a.test/', title: 'A', restricted: false, visits: [visit(3), visit(2)] }
      );
      assert.deepEqual(updated.visits?.map((v) => v.visitTime), [1, 2, 3]);
      assert.equal(updated.visitCount, 3);
    });

    it('starts the visit list when the existing entry had none', () => {
      const { entry: updated } = upsert(
        [entry({ url: 'https://a.test/' })],
        { url: 'https://a.test/', title: 'A', restricted: false, visits: [visit(1)] }
      );
      assert.deepEqual(updated.visits, [visit(1)]);
      assert.equal(updated.visitCount, 1);
    });

    it('an empty visit list leaves existing visits untouched', () => {
      const { entry: updated } = upsert(
        [entry({ url: 'https://a.test/', visits: [visit(1)], visitCount: 1 })],
        { url: 'https://a.test/', title: 'A', restricted: false, visits: [] }
      );
      assert.deepEqual(updated.visits, [visit(1)]);
      assert.equal(updated.visitCount, 1);
    });

    it('provided optional fields overwrite; omitted ones are kept', () => {
      const { entry: updated } = upsert(
        [entry({ url: 'https://a.test/', reason: 'old', matchedPattern: 'a.test', incognito: false })],
        { url: 'https://a.test/', title: 'A', restricted: false, reason: 'new', incognito: true }
      );
      assert.equal(updated.reason, 'new');
      assert.equal(updated.incognito, true);
      assert.equal(updated.matchedPattern, 'a.test');
    });

    it('does not mutate the input history or its entries', () => {
      const original = entry({ url: 'https://a.test/', title: 'Old', timestamp: 100, visits: [visit(1)], visitCount: 1 });
      const history = [original];
      upsert(history, { url: 'https://a.test/', title: 'New', restricted: true, visits: [visit(2)] });
      assert.equal(history.length, 1);
      assert.equal(history[0], original);
      assert.equal(original.title, 'Old');
      assert.equal(original.restricted, false);
      assert.deepEqual(original.visits, [visit(1)]);
    });
  });
});
