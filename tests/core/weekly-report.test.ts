import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../../src/core/default-settings.ts';
import {
  buildWeeklyStats,
  isWeeklyEligible,
  readWeeklyState,
  weeklyReportAction,
} from '../../src/core/weekly-report.ts';
import type { ClassificationResult, HistoryEntry, Settings } from '../../src/types/index.ts';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Local wall-clock instant (month is 1-based). */
function at(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

const NOW = at(2026, 10, 31, 12, 0);

function cls(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return { isEducational: false, category: '', reason: 'r', ...overrides };
}

let nextId = 1;
/** Entry with visits at the given instants (timestamp defaults to the newest visit). */
function entry(visitTimes: number[] | undefined, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  const id = nextId++;
  return {
    id,
    url: `https://site${id}.test/`,
    title: `Site ${id}`,
    timestamp: visitTimes && visitTimes.length > 0 ? Math.max(...visitTimes) : NOW - HOUR,
    restricted: false,
    ...(visitTimes ? { visits: visitTimes.map((visitTime) => ({ visitTime, transition: 'link' })) } : {}),
    ...overrides,
  };
}

describe('buildWeeklyStats', () => {
  it('empty history gives zeros, 0 % and no categories', () => {
    const stats = buildWeeklyStats([], NOW);
    assert.equal(stats.totalVisits, 0);
    assert.equal(stats.educationalVisits, 0);
    assert.equal(stats.educationalPercentage, 0);
    assert.equal(stats.restrictedAttempts, 0);
    assert.deepEqual(stats.topCategories, []);
  });

  it('history that is entirely older than 7 days gives zeros', () => {
    const stats = buildWeeklyStats([entry([NOW - 8 * DAY]), entry(undefined, { timestamp: NOW - 30 * DAY })], NOW);
    assert.equal(stats.totalVisits, 0);
    assert.equal(stats.educationalPercentage, 0);
  });

  it('counts visits (not entries) inside [now - 7 d, now) and splits restricted / educational', () => {
    const history: HistoryEntry[] = [
      // educational: 2 visits in window, 1 older than the window
      entry([NOW - DAY, NOW - 2 * DAY, NOW - 8 * DAY], { classification: cls({ isEducational: true }) }),
      // legacy flag only
      entry([NOW - 3 * DAY], { classification: cls({ isEducational: null, educational: true }) }),
      // restricted: 3 visits
      entry([NOW - HOUR, NOW - 2 * HOUR, NOW - 3 * HOUR], { restricted: true }),
      // restricted AND classified educational -> counts as restricted only
      entry([NOW - 4 * HOUR], { restricted: true, classification: cls({ isEducational: true }) }),
      // plain non-educational
      entry([NOW - 5 * HOUR], { classification: cls({ isEducational: false }) }),
      // no visits array: timestamp inside the window counts once
      entry(undefined, { timestamp: NOW - 6 * HOUR }),
      // no visits array: timestamp outside the window counts zero
      entry(undefined, { timestamp: NOW - 8 * DAY }),
      // exactly now - 7 d is inside; exactly now and the future are not
      entry([NOW - WEEK, NOW, NOW + HOUR]),
      // empty visits array falls back to the timestamp
      entry([], { timestamp: NOW - 2 * HOUR }),
      // isEducational false wins over legacy educational true
      entry([NOW - DAY], { classification: cls({ isEducational: false, educational: true }) }),
      // visits present -> timestamp is ignored (the only visit is old)
      entry([NOW - 9 * DAY], { timestamp: NOW - HOUR }),
    ];
    const stats = buildWeeklyStats(history, NOW);
    assert.equal(stats.totalVisits, 12); // 2+1+3+1+1+1+0+1+1+1+0
    assert.equal(stats.restrictedAttempts, 4);
    assert.equal(stats.educationalVisits, 3);
    assert.equal(stats.educationalPercentage, 25);
  });

  it('educationalPercentage is rounded to a whole percent', () => {
    const third = buildWeeklyStats(
      [entry([NOW - HOUR], { classification: cls({ isEducational: true }) }), entry([NOW - HOUR]), entry([NOW - HOUR])],
      NOW
    );
    assert.equal(third.educationalPercentage, 33);

    const twoThirds = buildWeeklyStats(
      [
        entry([NOW - HOUR], { classification: cls({ isEducational: true }) }),
        entry([NOW - HOUR], { classification: cls({ isEducational: true }) }),
        entry([NOW - HOUR]),
      ],
      NOW
    );
    assert.equal(twoThirds.educationalPercentage, 67);
  });

  it('topCategories: by visit count desc, ties alphabetical, at most 3, no placeholders', () => {
    function withCategory(category: string, visits: number): HistoryEntry {
      return entry(Array.from({ length: visits }, (_, i) => NOW - (i + 1) * HOUR), {
        classification: cls({ category }),
      });
    }
    const stats = buildWeeklyStats(
      [
        withCategory('Math', 3),
        withCategory('Games', 3),
        withCategory('Art', 2),
        withCategory('Science', 1),
        withCategory('Not specified', 9),
        withCategory('unknown', 8),
        withCategory('UNKNOWN', 7),
        withCategory('not specified', 6),
        withCategory('', 5),
      ],
      NOW
    );
    assert.deepEqual(stats.topCategories, ['Games', 'Math', 'Art']);
  });

  it('topCategories sums the visits of different entries with the same category', () => {
    const stats = buildWeeklyStats(
      [
        entry([NOW - HOUR], { classification: cls({ category: 'Art' }) }),
        entry([NOW - HOUR], { classification: cls({ category: 'Art' }) }),
        entry([NOW - HOUR, NOW - 2 * HOUR], { classification: cls({ category: 'Games' }) }),
        entry([NOW - HOUR], { classification: cls({ category: 'Zoo' }) }),
      ],
      NOW
    );
    assert.deepEqual(stats.topCategories, ['Art', 'Games', 'Zoo']);
  });

  it('topCategories ignores visits outside the window and entries without a classification', () => {
    const stats = buildWeeklyStats(
      [
        entry([NOW - 10 * DAY, NOW - 11 * DAY], { classification: cls({ category: 'Old' }) }),
        entry([NOW - HOUR]),
        entry([NOW - HOUR], { classification: cls({ category: 'Fresh' }) }),
      ],
      NOW
    );
    assert.deepEqual(stats.topCategories, ['Fresh']);
  });

  it('period boundaries are the local dates of now - 7 d and now', () => {
    const stats = buildWeeklyStats([], NOW);
    assert.equal(stats.periodEnd, '2026-10-31');
    assert.equal(stats.periodStart, '2026-10-24');
    const newYear = buildWeeklyStats([], at(2027, 1, 3, 15, 0));
    assert.equal(newYear.periodStart, '2026-12-27');
    assert.equal(newYear.periodEnd, '2027-01-03');
  });

  it('carries aggregates only: no URLs or titles in the result', () => {
    const stats = buildWeeklyStats(
      [entry([NOW - HOUR], { url: 'https://secret.example/path', title: 'Secret title', classification: cls({ category: 'Games' }) })],
      NOW
    );
    const serialized = JSON.stringify(stats);
    assert.equal(serialized.includes('secret.example'), false);
    assert.equal(serialized.includes('Secret title'), false);
  });

  it('does not mutate the history it reads', () => {
    const history = [entry([NOW - HOUR, NOW - 2 * HOUR])];
    const copy = structuredClone(history);
    buildWeeklyStats(history, NOW);
    assert.deepEqual(history, copy);
  });
});

describe('weeklyReportAction', () => {
  it('not eligible and never reported: clear the anchor so the 7 days restart on enable', () => {
    assert.equal(weeklyReportAction({}, false, NOW), 'clear-anchor');
    assert.equal(weeklyReportAction({ anchorAt: NOW - 3 * DAY }, false, NOW), 'clear-anchor');
  });

  it('not eligible but reported before: do nothing (keep lastWeeklyReportAt)', () => {
    assert.equal(weeklyReportAction({ lastReportAt: NOW - 20 * DAY }, false, NOW), 'none');
    assert.equal(weeklyReportAction({ lastReportAt: NOW - HOUR, anchorAt: NOW - 3 * DAY }, false, NOW), 'none');
  });

  it('eligible with no timestamps: set the anchor, do not send yet', () => {
    assert.equal(weeklyReportAction({}, true, NOW), 'set-anchor');
  });

  it('anchor: waits until exactly 7 days, then sends', () => {
    assert.equal(weeklyReportAction({ anchorAt: NOW - (WEEK - MIN) }, true, NOW), 'wait'); // 6 d 23 h 59 min
    assert.equal(weeklyReportAction({ anchorAt: NOW - (6 * DAY + 23 * HOUR) }, true, NOW), 'wait');
    assert.equal(weeklyReportAction({ anchorAt: NOW - WEEK }, true, NOW), 'send');
    assert.equal(weeklyReportAction({ anchorAt: NOW - 8 * DAY }, true, NOW), 'send');
  });

  it('last report: same 7 day rule, and it takes precedence over a stale anchor', () => {
    assert.equal(weeklyReportAction({ lastReportAt: NOW - WEEK }, true, NOW), 'send');
    assert.equal(weeklyReportAction({ lastReportAt: NOW - (WEEK - MIN) }, true, NOW), 'wait');
    assert.equal(weeklyReportAction({ lastReportAt: NOW - HOUR, anchorAt: NOW - 30 * DAY }, true, NOW), 'wait');
  });

  it('after a long gap exactly one report is due (no catch-up): the action is send, not a count', () => {
    assert.equal(weeklyReportAction({ lastReportAt: NOW - 60 * DAY }, true, NOW), 'send');
  });

  it('a last report in the future (clock moved back) waits', () => {
    assert.equal(weeklyReportAction({ lastReportAt: NOW + 2 * HOUR }, true, NOW), 'wait');
    assert.equal(weeklyReportAction({ lastReportAt: NOW + 3 * DAY }, true, NOW), 'wait');
  });

  it('a due report is held back for 60 minutes after the previous attempt (retry back-off)', () => {
    const due = { lastReportAt: NOW - 8 * DAY };
    assert.equal(weeklyReportAction({ ...due, lastAttemptAt: NOW - 59 * MIN }, true, NOW), 'wait');
    assert.equal(weeklyReportAction({ ...due, lastAttemptAt: NOW }, true, NOW), 'wait');
    assert.equal(weeklyReportAction({ ...due, lastAttemptAt: NOW - 60 * MIN }, true, NOW), 'send');
    assert.equal(weeklyReportAction({ ...due, lastAttemptAt: NOW - 3 * HOUR }, true, NOW), 'send');
  });

  it('an attempt stamp in the future (clock moved back) does not block reports forever', () => {
    assert.equal(weeklyReportAction({ lastReportAt: NOW - 8 * DAY, lastAttemptAt: NOW + 5 * DAY }, true, NOW), 'send');
  });

  it('the attempt back-off does not matter while nothing is due', () => {
    assert.equal(weeklyReportAction({ lastReportAt: NOW - DAY, lastAttemptAt: NOW - 3 * HOUR }, true, NOW), 'wait');
  });

  it('a sent report moves the next due time 7 days after the send', () => {
    // First check at the anchor + 7 d sends; once the caller stores lastReportAt = that instant,
    // the same moment and the following days wait until the 7 days are over again.
    const sentAt = NOW;
    assert.equal(weeklyReportAction({ lastReportAt: sentAt, anchorAt: sentAt - WEEK }, true, sentAt), 'wait');
    assert.equal(weeklyReportAction({ lastReportAt: sentAt }, true, sentAt + 6 * DAY), 'wait');
    assert.equal(weeklyReportAction({ lastReportAt: sentAt }, true, sentAt + WEEK), 'send');
  });
});

describe('isWeeklyEligible', () => {
  function tg(overrides: Partial<Settings> = {}): Settings {
    return {
      ...DEFAULT_SETTINGS,
      enableTelegramNotifications: true,
      telegramBotToken: '123:abc',
      telegramChatId: '42',
      notificationTypes: ['weekly'],
      ...overrides,
    };
  }

  it('is true with Telegram enabled, token, chat id and the weekly type selected', () => {
    assert.equal(isWeeklyEligible(tg()), true);
  });

  it('does not depend on quiet hours being enabled', () => {
    assert.equal(isWeeklyEligible(tg({ timeLimits: { enabled: false, allowedHours: { start: 8, end: 22 } } })), true);
    assert.equal(isWeeklyEligible(tg({ timeLimits: { enabled: true, allowedHours: { start: 8, end: 22 } } })), true);
  });

  it('is false when Telegram notifications are disabled', () => {
    assert.equal(isWeeklyEligible(tg({ enableTelegramNotifications: false })), false);
  });

  it('is false for an empty or whitespace-only token or chat id', () => {
    assert.equal(isWeeklyEligible(tg({ telegramBotToken: '' })), false);
    assert.equal(isWeeklyEligible(tg({ telegramBotToken: '  ' })), false);
    assert.equal(isWeeklyEligible(tg({ telegramChatId: '' })), false);
    assert.equal(isWeeklyEligible(tg({ telegramChatId: '\t' })), false);
  });

  it("is false when 'weekly' is not selected, even if 'timeLimit' is", () => {
    assert.equal(isWeeklyEligible(tg({ notificationTypes: ['restricted', 'suspicious', 'timeLimit'] })), false);
    assert.equal(isWeeklyEligible(tg({ notificationTypes: [] })), false);
  });
});

describe('readWeeklyState', () => {
  it('maps the persisted storage keys to the state fields', () => {
    assert.deepEqual(
      readWeeklyState({
        lastWeeklyReportAt: 1000,
        weeklyReportAnchorAt: 2000,
        weeklyReportLastAttemptAt: 3000,
      }),
      { lastReportAt: 1000, anchorAt: 2000, lastAttemptAt: 3000 }
    );
  });

  it('missing keys stay undefined', () => {
    const state = readWeeklyState({});
    assert.equal(state.lastReportAt, undefined);
    assert.equal(state.anchorAt, undefined);
    assert.equal(state.lastAttemptAt, undefined);
  });

  it('corrupt values (strings, NaN, Infinity, null, objects) are treated as missing', () => {
    const state = readWeeklyState({
      lastWeeklyReportAt: '1000',
      weeklyReportAnchorAt: Number.NaN,
      weeklyReportLastAttemptAt: Number.POSITIVE_INFINITY,
    });
    assert.equal(state.lastReportAt, undefined);
    assert.equal(state.anchorAt, undefined);
    assert.equal(state.lastAttemptAt, undefined);
    const state2 = readWeeklyState({ lastWeeklyReportAt: null, weeklyReportAnchorAt: {} });
    assert.equal(state2.lastReportAt, undefined);
    assert.equal(state2.anchorAt, undefined);
  });
});
