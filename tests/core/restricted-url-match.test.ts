/**
 * Regression for AC26 (Bagnik code QA, fix loop 1): the block page matched the twice-decoded display text of the
 * blocked URL against the raw URL stored in lastRestrictedUrl, so any URL with a %-escape never got its Stage 2
 * result and fell to "Detailed explanation not available." after 30 s.
 *
 * restricted.ts is a classic script (no imports, no exports), so it cannot be imported as a module. These tests
 * run the REAL page script in a vm sandbox with a small fake DOM / chrome.storage and drive it through the real
 * hand-off: the background writes lastRestrictedUrl (pending), the page opens with the URL exactly as
 * navigation-handler puts it into the query (encodeURIComponent), then the background settles the block with
 * applyExplanationToRestrictedInfo and chrome.storage.onChanged fires.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setImmediate as nextTick } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { applyExplanationToRestrictedInfo, type RestrictedInfo } from '../../src/core/restricted-info.ts';

interface TypeScriptApi {
  transpileModule(source: string, options: { compilerOptions: Record<string, unknown> }): { outputText: string };
  ScriptTarget: { ES2020: number };
}

const ts = createRequire(import.meta.url)('typescript') as TypeScriptApi;
const pageSource = readFileSync(fileURLToPath(new URL('../../src/pages/restricted.ts', import.meta.url)), 'utf8');
const pageScript = ts.transpileModule(pageSource, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

const PENDING_UI_TIMEOUT_MS = 30000;
const SYNTHESIZED = 'Category "Shopping" is blocked in the settings.';
const MODEL_REASON = 'This is an online shop; it sells toys.';
const SUGGESTION = 'https://www.khanacademy.org/math';

interface FakeElement {
  textContent: string;
  classList: { add(c: string): void; remove(c: string): void; toggle(c: string, force?: boolean): void; contains(c: string): boolean };
  addEventListener(type: string, fn: () => void): void;
}

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;

interface Page {
  text(id: string): string;
  isHidden(id: string): boolean;
  /** The background rewrote lastRestrictedUrl: storage holds the value and onChanged fires. */
  storageChanged(newValue: unknown): Promise<void>;
  /** Runs the page timers scheduled with exactly this delay (the 30 s pending timeout). */
  runTimers(delayMs: number): Promise<void>;
}

async function openPage(search: string, stored: unknown): Promise<Page> {
  const elements = new Map<string, FakeElement>();
  const startsHidden = new Set(['reasonInfo', 'educationalSuggestion', 'reasonNote']);
  const getElement = (id: string): FakeElement => {
    let found = elements.get(id);
    if (!found) {
      const classes = new Set<string>(startsHidden.has(id) ? ['hidden'] : []);
      found = {
        textContent: '',
        classList: {
          add: (c) => void classes.add(c),
          remove: (c) => void classes.delete(c),
          toggle: (c, force) => void (force === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : force ? classes.add(c) : classes.delete(c)),
          contains: (c) => classes.has(c),
        },
        addEventListener: () => {},
      };
      elements.set(id, found);
    }
    return found;
  };

  const timers = new Map<number, { fn: () => void; delay: number }>();
  let nextTimerId = 1;
  const setTimer = (fn: () => void, delay: number): number => {
    const id = nextTimerId++;
    timers.set(id, { fn, delay });
    return id;
  };
  const clearTimer = (id: number | undefined): void => void timers.delete(id as number);

  const listeners: StorageListener[] = [];
  const domReady: Array<() => Promise<void>> = [];
  const data: Record<string, unknown> = {};
  if (stored !== undefined) data.lastRestrictedUrl = stored;

  const silent = { log: () => {}, warn: () => {}, error: () => {} };
  const sandbox = {
    console: silent,
    URL,
    URLSearchParams,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    window: {
      location: { search, href: 'chrome-extension://test/pages/restricted.html' + search },
      setTimeout: setTimer,
      clearTimeout: clearTimer,
      history: { back: () => {} },
    },
    document: {
      body: getElement('body'),
      getElementById: getElement,
      addEventListener: (type: string, fn: () => Promise<void>) => {
        if (type === 'DOMContentLoaded') domReady.push(fn);
      },
    },
    chrome: {
      storage: {
        local: {
          get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]])),
          remove: async (keys: string[]) => void keys.forEach((k) => delete data[k]),
        },
        onChanged: { addListener: (fn: StorageListener) => void listeners.push(fn) },
      },
      tabs: { update: async () => {} },
    },
  };

  vm.runInNewContext(pageScript, sandbox);
  assert.equal(domReady.length, 1, 'the page registers one DOMContentLoaded handler');
  assert.equal(listeners.length, 1, 'the page registers one chrome.storage.onChanged listener');
  await domReady[0]();
  await nextTick();

  return {
    text: (id) => getElement(id).textContent,
    isHidden: (id) => getElement(id).classList.contains('hidden'),
    async storageChanged(newValue) {
      data.lastRestrictedUrl = newValue;
      for (const fn of listeners) fn({ lastRestrictedUrl: { newValue } }, 'local');
      await nextTick();
    },
    async runTimers(delayMs) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay !== delayMs) continue;
        timers.delete(id);
        timer.fn();
      }
      await nextTick();
    },
  };
}

/** The block page URL as navigation-handler builds it for a two-stage block (the claimed, pending case). */
function pendingSearch(url: string): string {
  return `?url=${encodeURIComponent(url)}&reason=content-restricted&category=Shopping&safetyLevel=Medium` +
    `&classificationReason=${encodeURIComponent(SYNTHESIZED)}&reasonPending=1`;
}

/** lastRestrictedUrl as navigation-handler stores a claimed block: raw details.url, pending. */
function pendingBlock(url: string): RestrictedInfo {
  return {
    url,
    timestamp: 1000,
    reason: 'content-restricted',
    matchedPattern: null,
    tabId: 7,
    suggestedUrl: null,
    category: 'Shopping',
    safetyLevel: 'Medium',
    classificationReason: SYNTHESIZED,
    reasonDetails: ['Category: Shopping', 'Safety Level: Medium', `Reason: ${SYNTHESIZED}`],
    noUrlReason: null,
    reasonPending: true,
    explanationStatus: 'pending',
  };
}

function settled(url: string): RestrictedInfo {
  return applyExplanationToRestrictedInfo(pendingBlock(url), {
    url,
    status: 'done',
    classification: { isEducational: false, category: 'Shopping', safetyLevel: 'Medium', reason: MODEL_REASON, suggestedUrl: SUGGESTION, noUrlReason: null },
  });
}

/** Blocked URLs exactly as Chrome reports them in details.url (percent-escaped) plus the odd decoded form. */
const BLOCKED_URLS: Array<[string, string]> = [
  ['plain ASCII', 'https://example.com/learn/math?chapter=3'],
  ['%20 in the query', 'https://www.amazon.com/s?k=lego%20set'],
  ['%25 (an escaped percent sign)', 'https://example.com/discount/50%25-off'],
  ['%2520 (an escape that is itself escaped)', 'https://example.com/files/a%2520b.txt'],
  ['+ next to %2B', 'https://example.com/search?q=c+a%2Bb'],
  ['non-ASCII path, percent-encoded', 'https://ru.wikipedia.org/wiki/%D0%9C%D0%BE%D1%81%D0%BA%D0%B2%D0%B0'],
  ['non-ASCII path, decoded form', 'https://ru.wikipedia.org/wiki/Москва'],
  ['query before fragment', 'https://example.com/p?b=2&a=1#sec%20tion'],
  ['fragment that looks like a query', 'https://example.com/app#/route?x=%20y&z=1'],
  ['malformed escape', 'https://example.com/100%/%E0%A4%A'],
];

describe('block page: Stage 2 result matches the blocked URL as stored, whatever escapes it holds (AC26)', () => {
  for (const [name, url] of BLOCKED_URLS) {
    describe(name, () => {
      it('pending page: the settled result arrives through storage.onChanged and the 30 s timeout does not override it', async () => {
        const page = await openPage(pendingSearch(url), pendingBlock(url));
        assert.match(page.text('reasonStatus'), /Preparing/);
        assert.equal(page.isHidden('educationalSuggestion'), true);

        await page.storageChanged(settled(url));
        assert.match(page.text('reasonStatus'), /ready/);
        assert.match(page.text('reasonDetails'), new RegExp(MODEL_REASON));
        assert.equal(page.isHidden('educationalSuggestion'), false);
        assert.equal(page.text('suggestedUrl'), SUGGESTION);

        await page.runTimers(PENDING_UI_TIMEOUT_MS);
        assert.match(page.text('reasonStatus'), /ready/);
        assert.doesNotMatch(page.text('reasonStatus'), /not available/);
      });

      it('page opened after the result was stored (initial read): ready at once, not pending then "not available"', async () => {
        const page = await openPage(pendingSearch(url), settled(url));
        assert.match(page.text('reasonStatus'), /ready/);
        assert.match(page.text('reasonDetails'), new RegExp(MODEL_REASON));
        assert.equal(page.isHidden('educationalSuggestion'), false);
        await page.runTimers(PENDING_UI_TIMEOUT_MS);
        assert.doesNotMatch(page.text('reasonStatus'), /not available/);
      });

      it('no url in the query (storage fallback): the stored block is still this page and its result applies', async () => {
        const page = await openPage('', pendingBlock(url));
        assert.match(page.text('reasonStatus'), /Preparing/);
        await page.storageChanged(settled(url));
        assert.match(page.text('reasonStatus'), /ready/);
        assert.match(page.text('reasonDetails'), new RegExp(MODEL_REASON));
        await page.runTimers(PENDING_UI_TIMEOUT_MS);
        assert.doesNotMatch(page.text('reasonStatus'), /not available/);
      });
    });
  }
});

describe('block page: a result for a different URL never applies', () => {
  const url = 'https://www.amazon.com/s?k=lego%20set';

  it('another site: the page stays pending and the 30 s timeout still ends it', async () => {
    const page = await openPage(pendingSearch(url), pendingBlock(url));
    await page.storageChanged(settled('https://www.amazon.com/s?k=duplo'));
    assert.match(page.text('reasonStatus'), /Preparing/);
    assert.doesNotMatch(page.text('reasonDetails'), new RegExp(MODEL_REASON));
    assert.equal(page.isHidden('educationalSuggestion'), true);
    await page.runTimers(PENDING_UI_TIMEOUT_MS);
    assert.match(page.text('reasonStatus'), /not available/);
  });

  it('the decoded look-alike of the blocked URL is a different URL: it does not apply', async () => {
    const page = await openPage(pendingSearch(url), pendingBlock(url));
    await page.storageChanged(settled('https://www.amazon.com/s?k=lego set'));
    assert.match(page.text('reasonStatus'), /Preparing/);
    assert.doesNotMatch(page.text('reasonDetails'), new RegExp(MODEL_REASON));
  });

  it('same host and path, other query or fragment: does not apply', async () => {
    const page = await openPage(pendingSearch(url), pendingBlock(url));
    await page.storageChanged(settled('https://www.amazon.com/s?k=lego%20set&page=2'));
    await page.storageChanged(settled('https://www.amazon.com/s?k=lego%20set#top'));
    assert.match(page.text('reasonStatus'), /Preparing/);
  });

  it('page opened while storage holds a settled block of another URL: it is not owned, stays on its own pending seed', async () => {
    const page = await openPage(pendingSearch(url), settled('https://www.amazon.com/s?k=duplo'));
    assert.match(page.text('reasonStatus'), /Preparing/);
    assert.doesNotMatch(page.text('reasonDetails'), new RegExp(MODEL_REASON));
  });
});

describe('block page: the decoded text is for display only', () => {
  it('the URL line shows the decoded text while matching uses the stored form', async () => {
    const url = 'https://www.amazon.com/s?k=lego%20set';
    const page = await openPage(pendingSearch(url), pendingBlock(url));
    assert.equal(page.text('restrictedUrl'), 'https://www.amazon.com/s?k=lego set');
    await page.storageChanged(settled(url));
    assert.match(page.text('reasonStatus'), /ready/);
    assert.equal(page.text('restrictedUrl'), 'https://www.amazon.com/s?k=lego set');
  });

  it('a URL that does not decode (malformed escape) is displayed as it is', async () => {
    const url = 'https://example.com/100%/%E0%A4%A';
    const page = await openPage(pendingSearch(url), pendingBlock(url));
    assert.equal(page.text('restrictedUrl'), url);
  });
});
