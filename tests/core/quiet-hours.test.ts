import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../../src/core/default-settings.ts';
import {
  formatHour,
  isQuietHoursBlockable,
  isQuietHoursNotifyEligible,
  isQuietNow,
  isWithinAllowedHours,
  quietWindowKey,
  shouldNotifyQuietHours,
} from '../../src/core/quiet-hours.ts';
import type { Settings } from '../../src/types/index.ts';

/** Local wall-clock instant (month is 1-based). Local constructors keep the tests TZ-independent. */
function at(year: number, month: number, day: number, hour: number, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute).getTime();
}

const DAYTIME = { start: 8, end: 22 };
const OVERNIGHT = { start: 22, end: 8 };

describe('isWithinAllowedHours — same-day window 8 -> 22', () => {
  const cases: Array<[string, number, boolean]> = [
    ['07:59', at(2026, 10, 30, 7, 59), false],
    ['08:00 (start minute is allowed)', at(2026, 10, 30, 8, 0), true],
    ['12:00', at(2026, 10, 30, 12, 0), true],
    ['21:59', at(2026, 10, 30, 21, 59), true],
    ['22:00 (end minute is blocked)', at(2026, 10, 30, 22, 0), false],
    ['00:00', at(2026, 10, 30, 0, 0), false],
    ['23:59', at(2026, 10, 30, 23, 59), false],
  ];
  for (const [label, ts, expected] of cases) {
    it(`${label} -> ${expected}`, () => {
      assert.equal(isWithinAllowedHours(ts, DAYTIME), expected);
    });
  }
});

describe('isWithinAllowedHours — overnight window 22 -> 8', () => {
  const cases: Array<[string, number, boolean]> = [
    ['21:59', at(2026, 10, 30, 21, 59), false],
    ['22:00 (start minute is allowed)', at(2026, 10, 30, 22, 0), true],
    ['23:59', at(2026, 10, 30, 23, 59), true],
    ['00:00', at(2026, 10, 31, 0, 0), true],
    ['07:59', at(2026, 10, 31, 7, 59), true],
    ['08:00 (end minute is blocked)', at(2026, 10, 31, 8, 0), false],
    ['12:00', at(2026, 10, 31, 12, 0), false],
  ];
  for (const [label, ts, expected] of cases) {
    it(`${label} -> ${expected}`, () => {
      assert.equal(isWithinAllowedHours(ts, OVERNIGHT), expected);
    });
  }
});

describe('isWithinAllowedHours — start === end means no quiet hours', () => {
  for (const hour of [8, 0, 23]) {
    it(`${hour} -> ${hour} is allowed at every sampled minute of the day`, () => {
      for (let h = 0; h < 24; h++) {
        for (const minute of [0, 1, 30, 59]) {
          assert.equal(
            isWithinAllowedHours(at(2026, 6, 15, h, minute), { start: hour, end: hour }),
            true,
            `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
          );
        }
      }
    });
  }
});

describe('isWithinAllowedHours — edge hours', () => {
  it('0 -> 22 allows from midnight and blocks from 22:00', () => {
    const w = { start: 0, end: 22 };
    assert.equal(isWithinAllowedHours(at(2026, 6, 15, 0, 0), w), true);
    assert.equal(isWithinAllowedHours(at(2026, 6, 15, 21, 59), w), true);
    assert.equal(isWithinAllowedHours(at(2026, 6, 15, 22, 0), w), false);
    assert.equal(isWithinAllowedHours(at(2026, 6, 15, 23, 59), w), false);
  });

  it('8 -> 0 is an overnight-style window: allowed 08:00-23:59, blocked at midnight', () => {
    const w = { start: 8, end: 0 };
    assert.equal(isWithinAllowedHours(at(2026, 6, 15, 7, 59), w), false);
    assert.equal(isWithinAllowedHours(at(2026, 6, 15, 8, 0), w), true);
    assert.equal(isWithinAllowedHours(at(2026, 6, 15, 23, 59), w), true);
    assert.equal(isWithinAllowedHours(at(2026, 6, 16, 0, 0), w), false);
  });

  it('counts exactly the allowed wall-clock minutes of an ordinary day', () => {
    // 1440 wall-clock minutes of a mid-June day (no DST transition in any common zone).
    function allowedMinutes(w: { start: number; end: number }): number {
      let n = 0;
      for (let h = 0; h < 24; h++) {
        for (let m = 0; m < 60; m++) {
          if (isWithinAllowedHours(at(2026, 6, 15, h, m), w)) n++;
        }
      }
      return n;
    }
    assert.equal(allowedMinutes({ start: 8, end: 22 }), 14 * 60);
    assert.equal(allowedMinutes({ start: 22, end: 8 }), 10 * 60);
    assert.equal(allowedMinutes({ start: 8, end: 0 }), 16 * 60);
    assert.equal(allowedMinutes({ start: 5, end: 5 }), 24 * 60);
  });
});

describe('isWithinAllowedHours — DST days follow the wall clock', () => {
  // US + EU spring/autumn transitions (and the days around them). In a zone without DST this
  // degenerates to the plain wall-clock check; in a DST zone it catches UTC / 24 h arithmetic.
  const ranges: Array<[number, number, number]> = [
    [2026, 3, 7], // 7..10 March
    [2026, 3, 28], // 28..31 March
    [2026, 10, 24], // 24..27 October
    [2026, 10, 31], // 31 Oct .. 3 Nov
  ];
  for (const [year, month, firstDay] of ranges) {
    it(`every existing local hour from ${year}-${month}-${firstDay} for 4 days follows h >= 8 && h < 22`, () => {
      for (let day = firstDay; day < firstDay + 4; day++) {
        for (let h = 0; h < 24; h++) {
          const d = new Date(year, month - 1, day, h, 30);
          if (d.getHours() !== h) continue; // local time skipped by the DST jump
          assert.equal(
            isWithinAllowedHours(d.getTime(), DAYTIME),
            h >= 8 && h < 22,
            `${d.toString()}`
          );
        }
      }
    });
  }
});

describe('isQuietNow', () => {
  it('is false at every time when quiet hours are disabled', () => {
    const tl = { enabled: false, allowedHours: DAYTIME };
    assert.equal(isQuietNow(tl, at(2026, 10, 30, 3, 0)), false);
    assert.equal(isQuietNow(tl, at(2026, 10, 30, 23, 0)), false);
    assert.equal(isQuietNow(tl, at(2026, 10, 30, 12, 0)), false);
  });

  it('when enabled it is true exactly outside the allowed window', () => {
    const tl = { enabled: true, allowedHours: DAYTIME };
    assert.equal(isQuietNow(tl, at(2026, 10, 30, 7, 59)), true);
    assert.equal(isQuietNow(tl, at(2026, 10, 30, 8, 0)), false);
    assert.equal(isQuietNow(tl, at(2026, 10, 30, 21, 59)), false);
    assert.equal(isQuietNow(tl, at(2026, 10, 30, 22, 0)), true);
  });

  it('when enabled with start === end it is never quiet', () => {
    const tl = { enabled: true, allowedHours: { start: 8, end: 8 } };
    assert.equal(isQuietNow(tl, at(2026, 10, 30, 3, 0)), false);
    assert.equal(isQuietNow(tl, at(2026, 10, 30, 23, 59)), false);
  });
});

describe('quietWindowKey — allowed 8 -> 22 (quiet period spans midnight)', () => {
  it('evening and late-night attempts of one period share the key of the evening date', () => {
    assert.equal(quietWindowKey(at(2026, 10, 30, 22, 0), DAYTIME), '2026-10-30');
    assert.equal(quietWindowKey(at(2026, 10, 30, 23, 59), DAYTIME), '2026-10-30');
    assert.equal(quietWindowKey(at(2026, 10, 31, 0, 0), DAYTIME), '2026-10-30');
    assert.equal(quietWindowKey(at(2026, 10, 31, 3, 0), DAYTIME), '2026-10-30');
    assert.equal(quietWindowKey(at(2026, 10, 31, 7, 59), DAYTIME), '2026-10-30');
  });

  it('is null while browsing is allowed (08:00 - 21:59)', () => {
    assert.equal(quietWindowKey(at(2026, 10, 31, 8, 0), DAYTIME), null);
    assert.equal(quietWindowKey(at(2026, 10, 31, 12, 0), DAYTIME), null);
    assert.equal(quietWindowKey(at(2026, 10, 31, 21, 59), DAYTIME), null);
  });

  it('the next evening starts a new period with a new key', () => {
    assert.notEqual(
      quietWindowKey(at(2026, 10, 31, 23, 30), DAYTIME),
      quietWindowKey(at(2026, 10, 30, 23, 30), DAYTIME)
    );
    assert.equal(quietWindowKey(at(2026, 10, 31, 23, 30), DAYTIME), '2026-10-31');
  });

  it('one period yields exactly one key across every half hour 22:00 -> 07:30', () => {
    const keys = new Set<string | null>();
    for (let h = 22; h < 24; h++) for (const m of [0, 30]) keys.add(quietWindowKey(at(2026, 6, 15, h, m), DAYTIME));
    for (let h = 0; h < 8; h++) for (const m of [0, 30]) keys.add(quietWindowKey(at(2026, 6, 16, h, m), DAYTIME));
    assert.deepEqual([...keys], ['2026-06-15']);
  });

  it('rolls the previous date over month and year boundaries and leap days', () => {
    assert.equal(quietWindowKey(at(2026, 1, 1, 0, 30), DAYTIME), '2025-12-31');
    assert.equal(quietWindowKey(at(2026, 3, 1, 0, 30), DAYTIME), '2026-02-28');
    assert.equal(quietWindowKey(at(2028, 3, 1, 0, 30), DAYTIME), '2028-02-29');
  });

  it('the previous date is a calendar date, also the morning after a DST change (no 24 h subtraction)', () => {
    // Morning after: US spring forward (8 Mar), EU spring forward (29 Mar), EU fall back (25 Oct), US fall back (1 Nov).
    assert.equal(quietWindowKey(at(2026, 3, 9, 0, 30), DAYTIME), '2026-03-08');
    assert.equal(quietWindowKey(at(2026, 3, 30, 0, 30), DAYTIME), '2026-03-29');
    assert.equal(quietWindowKey(at(2026, 10, 26, 0, 30), DAYTIME), '2026-10-25');
    assert.equal(quietWindowKey(at(2026, 11, 2, 0, 30), DAYTIME), '2026-11-01');
  });
});

describe('quietWindowKey — allowed 22 -> 8 (quiet period inside one day)', () => {
  it('blocked daytime (08:00 - 21:59) is keyed by that same date', () => {
    assert.equal(quietWindowKey(at(2026, 10, 31, 8, 0), OVERNIGHT), '2026-10-31');
    assert.equal(quietWindowKey(at(2026, 10, 31, 12, 0), OVERNIGHT), '2026-10-31');
    assert.equal(quietWindowKey(at(2026, 10, 31, 21, 59), OVERNIGHT), '2026-10-31');
  });

  it('is null while browsing is allowed (22:00 - 07:59)', () => {
    assert.equal(quietWindowKey(at(2026, 10, 31, 22, 0), OVERNIGHT), null);
    assert.equal(quietWindowKey(at(2026, 10, 31, 3, 0), OVERNIGHT), null);
    assert.equal(quietWindowKey(at(2026, 10, 31, 7, 59), OVERNIGHT), null);
  });
});

describe('quietWindowKey — start === end', () => {
  it('is null at every hour', () => {
    for (let h = 0; h < 24; h++) {
      assert.equal(quietWindowKey(at(2026, 10, 31, h, 15), { start: 8, end: 8 }), null, `hour ${h}`);
      assert.equal(quietWindowKey(at(2026, 10, 31, h, 15), { start: 0, end: 0 }), null, `hour ${h}`);
    }
  });
});

describe('shouldNotifyQuietHours', () => {
  it('is true only when eligible, inside a quiet period, and the period was not notified yet', () => {
    assert.equal(shouldNotifyQuietHours({ eligible: true, windowKey: '2026-10-30', lastNotifiedKey: null }), true);
    assert.equal(shouldNotifyQuietHours({ eligible: true, windowKey: '2026-10-30', lastNotifiedKey: undefined }), true);
    assert.equal(shouldNotifyQuietHours({ eligible: true, windowKey: '2026-10-30', lastNotifiedKey: '2026-10-29' }), true);
    assert.equal(shouldNotifyQuietHours({ eligible: true, windowKey: '2026-10-30', lastNotifiedKey: '2026-10-30' }), false);
    assert.equal(shouldNotifyQuietHours({ eligible: true, windowKey: null, lastNotifiedKey: null }), false);
    assert.equal(shouldNotifyQuietHours({ eligible: false, windowKey: '2026-10-30', lastNotifiedKey: null }), false);
  });

  it('night sequence: first attempt notifies, after-midnight attempt does not, next evening notifies again', () => {
    let persisted: string | null = null;
    function attempt(ts: number, eligible = true): boolean {
      const windowKey = quietWindowKey(ts, DAYTIME);
      const notify = shouldNotifyQuietHours({ eligible, windowKey, lastNotifiedKey: persisted });
      if (notify) persisted = windowKey; // the caller claims the key before sending
      return notify;
    }
    assert.equal(attempt(at(2026, 10, 30, 23, 30)), true);
    assert.equal(attempt(at(2026, 10, 30, 23, 45)), false);
    assert.equal(attempt(at(2026, 10, 31, 1, 0)), false);
    assert.equal(attempt(at(2026, 10, 31, 7, 30)), false);
    assert.equal(attempt(at(2026, 10, 31, 23, 30)), true);
  });

  it('while not eligible nothing is claimed, so enabling Telegram later the same night still notifies', () => {
    let persisted: string | null = null;
    function attempt(ts: number, eligible: boolean): boolean {
      const windowKey = quietWindowKey(ts, DAYTIME);
      const notify = shouldNotifyQuietHours({ eligible, windowKey, lastNotifiedKey: persisted });
      if (notify) persisted = windowKey;
      return notify;
    }
    assert.equal(attempt(at(2026, 10, 30, 22, 30), false), false);
    assert.equal(persisted, null);
    assert.equal(attempt(at(2026, 10, 31, 1, 0), true), true);
  });
});

describe('isQuietHoursNotifyEligible', () => {
  function tg(overrides: Partial<Settings> = {}): Settings {
    return {
      ...DEFAULT_SETTINGS,
      enableTelegramNotifications: true,
      telegramBotToken: '123:abc',
      telegramChatId: '42',
      notificationTypes: ['timeLimit'],
      ...overrides,
    };
  }

  it('is true with Telegram enabled, token, chat id and the timeLimit type selected', () => {
    assert.equal(isQuietHoursNotifyEligible(tg()), true);
  });

  it('is false when Telegram notifications are disabled', () => {
    assert.equal(isQuietHoursNotifyEligible(tg({ enableTelegramNotifications: false })), false);
  });

  it('is false for an empty or whitespace-only token or chat id', () => {
    assert.equal(isQuietHoursNotifyEligible(tg({ telegramBotToken: '' })), false);
    assert.equal(isQuietHoursNotifyEligible(tg({ telegramBotToken: '   ' })), false);
    assert.equal(isQuietHoursNotifyEligible(tg({ telegramChatId: '' })), false);
    assert.equal(isQuietHoursNotifyEligible(tg({ telegramChatId: ' \t ' })), false);
  });

  it("is false when the 'timeLimit' notification type is not selected, even if 'weekly' is", () => {
    assert.equal(isQuietHoursNotifyEligible(tg({ notificationTypes: ['restricted', 'suspicious', 'weekly'] })), false);
    assert.equal(isQuietHoursNotifyEligible(tg({ notificationTypes: [] })), false);
  });
});

describe('isQuietHoursBlockable', () => {
  it('blocks http and https pages', () => {
    assert.equal(isQuietHoursBlockable('https://x.com/a'), true);
    assert.equal(isQuietHoursBlockable('http://x.com'), true);
    assert.equal(isQuietHoursBlockable('HTTPS://X.COM/Path?q=1#h'), true);
  });

  it('never blocks browser pages, extension pages or non-network schemes', () => {
    const notBlockable = [
      'chrome://settings',
      'chrome-extension://abcdefghijklmnop/pages/restricted.html',
      'about:blank',
      'file:///a.html',
      'data:text/html,x',
      'devtools://devtools/bundled/inspector.html',
      'view-source:https://x.com',
      'ftp://x.com/file',
      'javascript:alert(1)',
    ];
    for (const url of notBlockable) assert.equal(isQuietHoursBlockable(url), false, url);
  });

  it('is false for strings that are not URLs', () => {
    assert.equal(isQuietHoursBlockable('not a url'), false);
    assert.equal(isQuietHoursBlockable(''), false);
  });
});

describe('formatHour', () => {
  it('zero-pads to HH:00', () => {
    assert.equal(formatHour(0), '00:00');
    assert.equal(formatHour(8), '08:00');
    assert.equal(formatHour(22), '22:00');
    assert.equal(formatHour(23), '23:00');
  });
});
