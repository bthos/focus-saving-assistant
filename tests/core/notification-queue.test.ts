import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  enqueueNotification,
  getFlushPeriodMinutes,
  isFlushAlarmCurrent,
  normalizeQueue,
  planNotificationFlush,
  removeDelivered,
  type NotificationFlushSettings,
  type QueuedNotification,
  type SuspiciousNotificationData,
} from '../../src/core/notification-queue.ts';

function payload(url: string): SuspiciousNotificationData {
  return {
    url,
    title: `Title of ${url}`,
    classification: { isEducational: false, category: 'Games', reason: 'fun' },
    accessAllowed: true,
    accessReason: 'allowed',
  };
}

function queued(timestamp: number, url = `https://site${timestamp}.test/`): QueuedNotification {
  return { type: 'suspicious', data: payload(url), timestamp };
}

function flushSettings(overrides: Partial<NotificationFlushSettings> = {}): NotificationFlushSettings {
  return {
    enableTelegramNotifications: true,
    telegramBotToken: '123:abc',
    telegramChatId: '42',
    notificationFrequency: 'hourly',
    notificationTypes: ['restricted', 'suspicious'],
    pageNotificationTypes: ['restricted', 'nonEducational'],
    ...overrides,
  };
}

describe('getFlushPeriodMinutes', () => {
  it('hourly flushes every 60 minutes and daily every 1440', () => {
    assert.equal(getFlushPeriodMinutes('hourly'), 60);
    assert.equal(getFlushPeriodMinutes('daily'), 1440);
  });

  it('has no period for instant (or a missing/unknown frequency)', () => {
    assert.equal(getFlushPeriodMinutes('instant'), null);
    assert.equal(getFlushPeriodMinutes(undefined), null);
    assert.equal(getFlushPeriodMinutes('weekly' as never), null);
  });
});

describe('planNotificationFlush', () => {
  it('schedules a recurring flush at the frequency period when everything is configured', () => {
    assert.deepEqual(planNotificationFlush(flushSettings({ notificationFrequency: 'hourly' })), {
      mode: 'periodic',
      periodInMinutes: 60,
    });
    assert.deepEqual(planNotificationFlush(flushSettings({ notificationFrequency: 'daily' })), {
      mode: 'periodic',
      periodInMinutes: 1440,
    });
  });

  it('is off for instant frequency', () => {
    assert.deepEqual(planNotificationFlush(flushSettings({ notificationFrequency: 'instant' })), { mode: 'off' });
  });

  it('is off when Telegram notifications are disabled', () => {
    assert.deepEqual(planNotificationFlush(flushSettings({ enableTelegramNotifications: false })), { mode: 'off' });
  });

  it('is off without a bot token or chat id (blank counts as missing)', () => {
    assert.deepEqual(planNotificationFlush(flushSettings({ telegramBotToken: '' })), { mode: 'off' });
    assert.deepEqual(planNotificationFlush(flushSettings({ telegramBotToken: '   ' })), { mode: 'off' });
    assert.deepEqual(planNotificationFlush(flushSettings({ telegramChatId: '' })), { mode: 'off' });
  });

  it("is off when 'suspicious' notifications are disabled", () => {
    assert.deepEqual(planNotificationFlush(flushSettings({ notificationTypes: ['restricted'] })), { mode: 'off' });
  });

  it('is off when non-educational page notifications are disabled', () => {
    assert.deepEqual(
      planNotificationFlush(flushSettings({ pageNotificationTypes: ['restricted', 'allowed'] })),
      { mode: 'off' }
    );
  });

  it('treats unset notification type lists as the defaults (suspicious on)', () => {
    const settings = flushSettings();
    delete (settings as Partial<NotificationFlushSettings>).notificationTypes;
    delete (settings as Partial<NotificationFlushSettings>).pageNotificationTypes;
    assert.deepEqual(planNotificationFlush(settings), { mode: 'periodic', periodInMinutes: 60 });
  });
});

describe('isFlushAlarmCurrent', () => {
  it('is false when there is no alarm yet', () => {
    assert.equal(isFlushAlarmCurrent(undefined, 60), false);
  });

  it('is true when the existing alarm already repeats at the wanted period', () => {
    assert.equal(isFlushAlarmCurrent({ periodInMinutes: 60 }, 60), true);
  });

  it('is false after the frequency changed, or for a one-shot alarm', () => {
    assert.equal(isFlushAlarmCurrent({ periodInMinutes: 60 }, 1440), false);
    assert.equal(isFlushAlarmCurrent({}, 60), false);
  });
});

describe('enqueueNotification', () => {
  it('appends the item with the given time and keeps earlier items first', () => {
    const queue = enqueueNotification([queued(1000)], 'suspicious', payload('https://b.test/'), 2000);
    assert.deepEqual(queue.map((item) => item.timestamp), [1000, 2000]);
    assert.equal(queue[1].data.url, 'https://b.test/');
    assert.equal(queue[1].type, 'suspicious');
  });

  it('drops the oldest items once the cap is exceeded', () => {
    let queue: QueuedNotification[] = [];
    for (let i = 1; i <= 5; i++) {
      queue = enqueueNotification(queue, 'suspicious', payload(`https://s${i}.test/`), i * 10, 3);
    }
    assert.deepEqual(queue.map((item) => item.data.url), [
      'https://s3.test/',
      'https://s4.test/',
      'https://s5.test/',
    ]);
  });

  it('defaults to a cap of 500 items', () => {
    let queue: QueuedNotification[] = [];
    for (let i = 1; i <= 503; i++) {
      queue = enqueueNotification(queue, 'suspicious', payload(`https://s${i}.test/`), i);
    }
    assert.equal(queue.length, 500);
    assert.equal(queue[0].data.url, 'https://s4.test/');
    assert.equal(queue[499].data.url, 'https://s503.test/');
  });

  it('keeps timestamps strictly increasing when the clock stalls or goes backwards', () => {
    let queue = enqueueNotification([], 'suspicious', payload('https://a.test/'), 5000);
    queue = enqueueNotification(queue, 'suspicious', payload('https://b.test/'), 5000);
    queue = enqueueNotification(queue, 'suspicious', payload('https://c.test/'), 100);
    const stamps = queue.map((item) => item.timestamp);
    assert.deepEqual(stamps, [5000, 5001, 5002]);
  });

  it('does not mutate the input queue', () => {
    const original = [queued(1)];
    enqueueNotification(original, 'suspicious', payload('https://b.test/'), 2);
    assert.equal(original.length, 1);
  });
});

describe('normalizeQueue', () => {
  it('returns an empty queue for anything that is not an array', () => {
    assert.deepEqual(normalizeQueue(undefined), []);
    assert.deepEqual(normalizeQueue(null), []);
    assert.deepEqual(normalizeQueue({ 0: queued(1) }), []);
    assert.deepEqual(normalizeQueue('queue'), []);
  });

  it('drops malformed entries instead of failing the whole queue', () => {
    const good = queued(10);
    const raw = [
      good,
      null,
      'text',
      { type: 'suspicious', timestamp: 11 },
      { type: 'suspicious', data: { url: 'https://x.test/' }, timestamp: 12 },
      { type: 'suspicious', data: payload('https://y.test/'), timestamp: 'later' },
      { type: 'weekly', data: payload('https://z.test/'), timestamp: 13 },
    ];
    assert.deepEqual(normalizeQueue(raw), [good]);
  });

  it('trims an oversized stored queue to the newest items', () => {
    const raw = Array.from({ length: 10 }, (_, i) => queued(i + 1));
    assert.deepEqual(normalizeQueue(raw, 4).map((item) => item.timestamp), [7, 8, 9, 10]);
  });

  it('trims to 500 by default', () => {
    const raw = Array.from({ length: 1200 }, (_, i) => queued(i + 1));
    const normalized = normalizeQueue(raw);
    assert.equal(normalized.length, 500);
    assert.equal(normalized[0].timestamp, 701);
  });
});

describe('removeDelivered', () => {
  it('clears everything that was sent', () => {
    const sent = [queued(1), queued(2)];
    assert.deepEqual(removeDelivered(sent, sent), []);
  });

  it('keeps items queued after the snapshot was taken', () => {
    const snapshot = [queued(1), queued(2)];
    const current = [...snapshot, queued(3), queued(4)];
    assert.deepEqual(removeDelivered(current, snapshot).map((item) => item.timestamp), [3, 4]);
  });

  it('copes with delivered items that the cap already dropped', () => {
    const snapshot = [queued(1), queued(2), queued(3)];
    const current = [queued(3), queued(4)];
    assert.deepEqual(removeDelivered(current, snapshot).map((item) => item.timestamp), [4]);
  });

  it('keeps everything when nothing was delivered', () => {
    const current = [queued(1), queued(2)];
    assert.deepEqual(removeDelivered(current, []), current);
  });
});
