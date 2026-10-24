// syncSchedule / doSync: booked vs wanted notifications, re-arming, past times, refill time.
import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { MAX_REMINDERS, MAX_REMINDERS_ANDROID, planNotifications } from '../src/core/notificationPlan.ts';
import { startBreak, stopReminders } from '../src/core/transitions.ts';
import { appData, captureWarnings, freeze, HOUR, MIN, SEC, T0, world } from './helpers/world.mjs';

const VIBRATION = [0, 120, 90, 160];
const START_QUACK = 'alerts2_start_quack_v';

type Opts = Parameters<typeof world>[0] & { data?: unknown; timers?: boolean };

async function setup(t: TestContext, opts: Opts = {}) {
  const clock = freeze(t, T0, { timers: opts.timers });
  const w = await world({ data: appData(), ...opts });
  const N = await w.load('services/notifications');
  const storage = await w.load('services/storage');
  /** What the plan says should be booked right now (the source of truth for these tests). */
  const want = () =>
    planNotifications(storage.getData(), Date.now(), w.os === 'android' ? MAX_REMINDERS_ANDROID : MAX_REMINDERS);
  const count = (fn: string) => w.notif.callsOf(fn).length;
  return { w, N, storage, clock, want, count };
}

const byKind = (ids: string[], kind: string) => ids.filter((id) => id.startsWith(`${kind}_`));

describe('syncSchedule: booking', () => {
  it('the first sync books every planned notification, at its time, on its channel', async (t) => {
    const { w, N, want } = await setup(t);
    await N.syncSchedule();
    const planned = want();
    assert.equal(planned.length, MAX_REMINDERS_ANDROID + 1);
    assert.deepEqual(w.notif.scheduledIds(), planned.map((n) => n.id));
    for (const n of planned) {
      const booked = w.notif.state.scheduled.get(n.id);
      assert.deepEqual(booked.trigger, { type: 'date', timestamp: n.at, channelId: START_QUACK }, n.id);
      assert.equal(booked.content.title, n.title);
      assert.equal(booked.content.body, n.body);
      assert.deepEqual(booked.content.data, { kind: n.kind });
    }
  });

  it('a reminder has the Start/Snooze buttons, the sound and the vibration; the last call has no buttons', async (t) => {
    const { w, N } = await setup(t);
    await N.syncSchedule();
    const [due] = byKind(w.notif.scheduledIds(), 'due');
    const [out] = byKind(w.notif.scheduledIds(), 'out');
    const d = w.notif.state.scheduled.get(due).content;
    assert.equal(d.categoryIdentifier, 'break_due');
    assert.equal(d.sound, 'quack.wav');
    assert.deepEqual(d.vibrate, VIBRATION);
    assert.equal(d.color, '#F5B935');
    // Android: no thread, or expo-notifications adds a group summary notification.
    assert.equal(d.threadIdentifier, undefined);
    const o = w.notif.state.scheduled.get(out).content;
    assert.equal(o.categoryIdentifier, undefined);
    assert.deepEqual(o.data, { kind: 'out' });
  });

  it('books 150 reminders ahead on Android and 60 on iOS, plus the last call', async (t) => {
    for (const os of ['android', 'ios'] as const) {
      const { w, N } = await setup(t, { os });
      await N.syncSchedule();
      const ids = w.notif.scheduledIds();
      assert.equal(byKind(ids, 'due').length, os === 'android' ? 150 : 60, os);
      assert.equal(byKind(ids, 'out').length, 1, os);
      t.mock.timers.reset();
    }
  });

  it('iOS: reminders share one thread and carry no channel', async (t) => {
    const { w, N } = await setup(t, { os: 'ios' });
    await N.syncSchedule();
    for (const r of w.notif.scheduled()) {
      assert.equal(r.content.threadIdentifier, 'quack');
      assert.equal(r.trigger.channelId, undefined);
    }
    assert.equal(w.notif.callsOf('setNotificationChannelAsync').length, 0);
  });

  it('a second identical sync books nothing and cancels nothing', async (t) => {
    const { N, count, w } = await setup(t);
    await N.syncSchedule();
    w.notif.clearCalls();
    await N.syncSchedule();
    assert.equal(count('scheduleNotificationAsync'), 0);
    assert.equal(count('cancelScheduledNotificationAsync'), 0);
  });

  it('as time passes, a sync books only the new reminder at the end and moves the last call', async (t) => {
    const { w, N, clock, want, count } = await setup(t);
    await N.syncSchedule();
    const oldOut = byKind(w.notif.scheduledIds(), 'out')[0];
    clock.set(T0 + 30 * MIN); // the first reminder (T0 + 20 min) has gone off
    w.notif.clearCalls();
    await N.syncSchedule();
    const planned = want();
    const newDue = planned.filter((n) => n.kind === 'due').at(-1)!;
    const newOut = planned.find((n) => n.kind === 'out')!;
    assert.deepEqual(
      w.notif.callsOf('scheduleNotificationAsync').map(([r]) => r.identifier).sort(),
      [newDue.id, newOut.id].sort(),
    );
    assert.deepEqual(w.notif.callsOf('cancelScheduledNotificationAsync'), [[oldOut]]);
    assert.equal(count('scheduleNotificationAsync'), 2);
    assert.deepEqual(w.notif.scheduledIds().sort(), planned.map((n) => n.id).sort());
  });

  it('syncs run one at a time: two started together book each reminder once', async (t) => {
    const { N, count } = await setup(t);
    await Promise.all([N.syncSchedule(), N.syncSchedule(), N.syncSchedule()]);
    assert.equal(count('scheduleNotificationAsync'), MAX_REMINDERS_ANDROID + 1);
  });

  it('changed settings replace every id (the content fingerprint) and keep the times', async (t) => {
    const { w, N, storage } = await setup(t);
    await N.syncSchedule();
    const before = w.notif.scheduled().map((r) => ({ id: r.identifier, at: r.trigger.timestamp }));
    const settings = await w.load('services/settings');
    settings.saveSettings({ snoozeMin: 10 }, { sync: false });
    assert.equal(storage.getData().settings.snoozeMin, 10);
    w.notif.clearCalls();
    await N.syncSchedule();
    const after = w.notif.scheduled().map((r) => ({ id: r.identifier, at: r.trigger.timestamp }));
    assert.equal(after.length, before.length);
    assert.deepEqual(after.map((a) => a.at), before.map((b) => b.at));
    const oldIds = new Set(before.map((b) => b.id));
    assert.ok(after.every((a) => !oldIds.has(a.id)), 'every id changed');
    assert.equal(w.notif.callsOf('cancelScheduledNotificationAsync').length, before.length);
  });

  it("the reminder's Snooze button follows the snooze length", async (t) => {
    const { w, N } = await setup(t);
    await N.syncSchedule();
    assert.deepEqual(w.notif.state.categories.get('break_due').actions.map((a: { buttonTitle: string }) => a.buttonTitle), [
      'Start',
      'Snooze 5 min',
    ]);
    const settings = await w.load('services/settings');
    settings.saveSettings({ snoozeMin: 15 }, { sync: false });
    await N.syncSchedule();
    assert.equal(w.notif.state.categories.get('break_due').actions[1].buttonTitle, 'Snooze 15 min');
  });

  it('stopping reminders cancels them all; resuming books them again from now', async (t) => {
    const { w, N, clock, want } = await setup(t);
    await N.syncSchedule();
    const timer = await w.load('services/timer');
    w.native.pendingActions.push({ type: 'stop', at: T0 + MIN });
    clock.set(T0 + MIN);
    timer.applyTimerActions();
    await N.syncSchedule();
    assert.deepEqual(w.notif.scheduledIds(), []);
    assert.equal(w.native.lastPlan.paused, true);
    assert.deepEqual(w.native.lastPlan.reminders, []);

    const breaks = await w.load('services/breaks');
    clock.set(T0 + 10 * MIN);
    breaks.resumeNow();
    await N.syncSchedule();
    const planned = want();
    assert.equal(planned[0]!.at, T0 + 30 * MIN, 'counts from the resume');
    assert.deepEqual(w.notif.scheduledIds().sort(), planned.map((n) => n.id).sort());
    assert.equal(w.native.lastPlan.paused, false);
  });

  it('a running break books its break-over alert on the end channel, with the end sound and no buttons', async (t) => {
    const { w, N } = await setup(t, {
      data: appData({ settings: { endSound: 'chime', endVibrate: false } }),
    });
    const breaks = await w.load('services/breaks');
    breaks.beginBreak();
    await N.syncSchedule();
    const [overId] = byKind(w.notif.scheduledIds(), 'over');
    assert.ok(overId, 'break-over booked');
    const over = w.notif.state.scheduled.get(overId);
    assert.deepEqual(over.trigger, { type: 'date', timestamp: T0 + 20 * SEC, channelId: 'alerts2_end_chime_n' });
    assert.equal(over.content.sound, 'chime.wav');
    assert.equal(over.content.vibrate, undefined);
    assert.equal(over.content.categoryIdentifier, undefined);
    assert.deepEqual(over.content.data, { kind: 'over' });
    assert.equal(w.native.lastPlan.overId, overId);
    assert.equal(w.native.lastPlan.breakEndsAt, T0 + 20 * SEC);
  });

  it('skipping a running break cancels its break-over alert', async (t) => {
    const { w, N } = await setup(t);
    const breaks = await w.load('services/breaks');
    breaks.beginBreak();
    await N.syncSchedule();
    const [overId] = byKind(w.notif.scheduledIds(), 'over');
    breaks.skipNow();
    await N.syncSchedule();
    assert.equal(byKind(w.notif.scheduledIds(), 'over').length, 0);
    assert.ok(w.notif.callsOf('cancelScheduledNotificationAsync').some(([id]) => id === overId));
    assert.equal(w.native.lastPlan.overId, '');
    assert.equal(w.native.lastPlan.breakEndsAt, 0);
  });

  it('a time less than 2 s away is skipped (Android drops it, iOS rejects it); one further away is booked', async (t) => {
    for (const [endsIn, booked] of [
      [1500, false],
      [2000, false],
      [3000, true],
    ] as const) {
      const { w, N } = await setup(t, {
        data: appData({ timer: { anchor: T0 + endsIn, setAt: T0, breakEndsAt: T0 + endsIn } }),
      });
      await N.syncSchedule();
      assert.equal(byKind(w.notif.scheduledIds(), 'over').length, booked ? 1 : 0, `break ends in ${endsIn} ms`);
      assert.equal(w.notif.state.droppedPast.length, 0, 'nothing in the past reaches the scheduler');
      // The reminders after the break are booked either way.
      assert.equal(byKind(w.notif.scheduledIds(), 'due').length, MAX_REMINDERS_ANDROID);
      t.mock.timers.reset();
    }
  });

  it('not onboarded: nothing is booked and the tray timer is turned off', async (t) => {
    const { w, N, count } = await setup(t, { data: appData({ onboarded: false }) });
    await N.syncSchedule();
    assert.equal(count('scheduleNotificationAsync'), 0);
    assert.equal(count('setNotificationChannelAsync'), 0);
    assert.equal(w.native.plans.length, 1);
    assert.deepEqual(
      { ...w.native.lastPlan, ...pickText(w.native.lastPlan) },
      { ...OFF_PLAN, ...pickText(w.native.lastPlan) },
    );
  });

  it('no notification permission: nothing is booked and the tray timer is turned off', async (t) => {
    const { w, N, count } = await setup(t, { permission: false });
    await N.syncSchedule();
    assert.equal(count('scheduleNotificationAsync'), 0);
    assert.equal(w.native.lastPlan.enabled, false);
    assert.deepEqual(w.native.lastPlan.reminders, []);
    assert.equal(w.native.lastPlan.refillAt, 0);
  });

  it('iOS: provisional permission counts as allowed', async (t) => {
    const { w, N } = await setup(t, { os: 'ios' });
    w.notif.setPermission(false, w.N.IosAuthorizationStatus.PROVISIONAL);
    await N.syncSchedule();
    assert.equal(byKind(w.notif.scheduledIds(), 'due').length, MAX_REMINDERS);
  });

  it('test notifications are never cancelled, even when reminders are stopped', async (t) => {
    const { w, N, storage } = await setup(t);
    await N.sendTestReminder(10);
    const testId = w.notif.scheduledIds().find((id) => id.startsWith('test_'))!;
    await N.syncSchedule();
    storage.updateData((d: Parameters<typeof stopReminders>[0]) => stopReminders(d, Date.now()));
    await N.syncSchedule();
    assert.deepEqual(w.notif.scheduledIds(), [testId]);
    assert.ok(!w.notif.callsOf('cancelScheduledNotificationAsync').some(([id]) => id === testId));
  });

  it('iOS: old notifications are cancelled before new ones are booked, so a change never hits the 64 limit', async (t) => {
    const { w, N } = await setup(t, { os: 'ios' });
    const breaks = await w.load('services/breaks');
    breaks.beginBreak(); // 60 reminders + break over + last call
    await N.syncSchedule();
    await N.sendTestReminder(10);
    assert.equal(w.notif.scheduledIds().length, 63);
    const settings = await w.load('services/settings');
    settings.saveSettings({ snoozeMin: 10 }, { sync: false }); // every id changes
    await N.syncSchedule();
    assert.deepEqual(w.notif.state.iosLimitDropped, []);
    assert.equal(w.notif.scheduledIds().length, 63);
  });

  it('notifications booked by an older version (other ids) are cancelled', async (t) => {
    const { w, N } = await setup(t);
    w.notif.addScheduled('due_123_oldfp', T0 + 5 * MIN);
    w.notif.addScheduled('breaks_reminder_1', T0 + 6 * MIN);
    await N.syncSchedule();
    const ids = w.notif.scheduledIds();
    assert.ok(!ids.includes('due_123_oldfp'));
    assert.ok(!ids.includes('breaks_reminder_1'));
  });
});

describe('syncSchedule: re-arming', () => {
  /** Book what the plan wants, as a previous process would have. */
  async function bookedByEarlierRun(t: TestContext, os: 'android' | 'ios') {
    const s = await setup(t, { os });
    for (const n of s.want()) s.w.notif.addScheduled(n.id, n.at, { data: { kind: n.kind } });
    return s;
  }

  it('Android: the first sync in a process re-books reminders that are already listed (force stop drops alarms)', async (t) => {
    const { N, count } = await bookedByEarlierRun(t, 'android');
    await N.syncSchedule();
    assert.equal(count('scheduleNotificationAsync'), MAX_REMINDERS_ANDROID + 1);
    await N.syncSchedule();
    assert.equal(count('scheduleNotificationAsync'), MAX_REMINDERS_ANDROID + 1, 'only once per process');
  });

  it('iOS: the first sync books only what is missing', async (t) => {
    const { N, count } = await bookedByEarlierRun(t, 'ios');
    await N.syncSchedule();
    assert.equal(count('scheduleNotificationAsync'), 0);
  });

  it('a failed booking is reported and leaves the plan un-armed, so the next sync re-books everything', async (t) => {
    const { w, N, count } = await setup(t);
    const warnings = captureWarnings(t);
    let failOnce = true;
    w.notif.state.scheduleFailure = () => {
      if (!failOnce) return undefined;
      failOnce = false;
      return new Error('Alarm limit reached');
    };
    await N.syncSchedule();
    assert.ok(warnings.some(([m]) => /Could not update 1 reminders/.test(String(m))), JSON.stringify(warnings));
    assert.equal(w.notif.scheduledIds().length, MAX_REMINDERS_ANDROID);
    w.notif.clearCalls();
    await N.syncSchedule();
    assert.equal(count('scheduleNotificationAsync'), MAX_REMINDERS_ANDROID + 1, 're-books all, not just the missing one');
    w.notif.clearCalls();
    await N.syncSchedule();
    assert.equal(count('scheduleNotificationAsync'), 0, 'armed now');
  });

  it('a failed cancel also leaves the plan un-armed', async (t) => {
    const { w, N, count } = await setup(t);
    captureWarnings(t);
    w.notif.addScheduled('due_1_stale', T0 + 5 * MIN);
    w.notif.state.cancelFailure = (id: string) => (id === 'due_1_stale' ? new Error('nope') : undefined);
    await N.syncSchedule();
    w.notif.state.cancelFailure = null;
    w.notif.clearCalls();
    await N.syncSchedule();
    assert.equal(count('scheduleNotificationAsync'), MAX_REMINDERS_ANDROID + 1);
    assert.ok(!w.notif.scheduledIds().includes('due_1_stale'));
  });

  it('the exact-alarm permission changing either way re-books everything, once', async (t) => {
    const { w, N, count } = await setup(t);
    await N.syncSchedule();
    const runs: number[] = [];
    for (const exact of [true, false, false, true, true]) {
      w.notif.setExactAlarms(exact);
      w.notif.clearCalls();
      await N.syncSchedule();
      runs.push(count('scheduleNotificationAsync'));
    }
    const all = MAX_REMINDERS_ANDROID + 1;
    assert.deepEqual(runs, [0, all, 0, all, 0]);
  });

  it('Android 11 and older never ask about exact alarms and never re-arm for them', async (t) => {
    const { w, N, count } = await setup(t, { version: 30 });
    await N.syncSchedule();
    w.notif.setExactAlarms(false);
    w.notif.clearCalls();
    await N.syncSchedule();
    assert.equal(count('getExactAlarmPermissionsAsync'), 0);
    assert.equal(count('scheduleNotificationAsync'), 0);
  });

  it('a sync that throws is reported, and the next sync still runs', async (t) => {
    const { w, N } = await setup(t);
    const warnings = captureWarnings(t);
    w.notif.state.getAllFailure = new Error('binder died');
    await N.syncSchedule();
    assert.ok(warnings.some(([m]) => m === 'Could not update reminders'));
    w.notif.state.getAllFailure = null;
    await N.syncSchedule();
    assert.equal(w.notif.scheduledIds().length, MAX_REMINDERS_ANDROID + 1);
  });
});

describe('syncSchedule: refill time and the tray timer plan', () => {
  it('hands the tray timer the reminder times and a refill 12 hours out when the reminders reach further', async (t) => {
    const { w, N, want } = await setup(t);
    await N.syncSchedule();
    const due = want().filter((n) => n.kind === 'due');
    // Two thirds through 150 reminders every 20 min is 33 h away: capped at 12 h.
    assert.ok(due[100]!.at > T0 + 12 * HOUR);
    assert.equal(w.native.lastPlan.refillAt, T0 + 12 * HOUR);
    assert.deepEqual(w.native.lastPlan.reminders, due.map((n) => n.at));
    assert.equal(w.native.lastPlan.enabled, true);
    assert.equal(w.native.lastPlan.paused, false);
  });

  it('refills two thirds of the way through the reminders when that comes first', async (t) => {
    const data = appData({ settings: { rule202020: false, workMin: 5 } });
    const { w, N, want } = await setup(t, { data });
    await N.syncSchedule();
    const due = want().filter((n) => n.kind === 'due');
    assert.equal(due.length, 150);
    assert.equal(w.native.lastPlan.refillAt, due[100]!.at);
    assert.equal(w.native.lastPlan.refillAt, T0 + 101 * 5 * MIN);
  });

  it('counts only reminders toward the two-thirds point (not the break-over or last call)', async (t) => {
    const data = appData({
      settings: { rule202020: false, workMin: 5 },
      timer: { anchor: T0 + 20 * SEC, setAt: T0, breakEndsAt: T0 + 20 * SEC },
    });
    const { w, N } = await setup(t, { data });
    await N.syncSchedule();
    assert.equal(w.native.lastPlan.refillAt, T0 + 20 * SEC + 101 * 5 * MIN);
  });

  it('no refill when no reminders are planned (stopped)', async (t) => {
    const data = appData({ timer: { anchor: T0, setAt: T0, breakEndsAt: null, paused: true } });
    const { w, N } = await setup(t, { data });
    await N.syncSchedule();
    assert.equal(w.native.lastPlan.refillAt, 0);
    assert.equal(w.native.lastPlan.paused, true);
  });

  it('a stopped break still books its break-over alert but no reminders or refill', async (t) => {
    // A break started while reminders are stopped keeps them stopped (core startBreak).
    const { w, N, storage } = await setup(t, {
      data: appData({ timer: { anchor: T0, setAt: T0, breakEndsAt: null, paused: true } }),
    });
    storage.updateData((d: Parameters<typeof startBreak>[0]) => startBreak(d, Date.now()));
    await N.syncSchedule();
    assert.deepEqual(w.notif.scheduledIds().map((id: string) => id.split('_')[0]), ['over']);
    assert.equal(w.native.lastPlan.refillAt, 0);
  });

  it('iOS has no timer module: syncing books reminders without touching it', async (t) => {
    const { w, N } = await setup(t, { os: 'ios' });
    await N.syncSchedule();
    assert.equal(w.native, null);
    assert.ok(w.notif.scheduledIds().length > 0);
  });
});

const OFF_PLAN = { enabled: false, paused: false, breakEndsAt: 0, overId: '', reminders: [], refillAt: 0 };
const TEXT_KEYS = [
  'nextTitle',
  'nextAtTitle',
  'breakTitle',
  'stopLabel',
  'stoppedTitle',
  'stoppedText',
  'resumeLabel',
  'channelName',
];
function pickText(plan: Record<string, unknown>) {
  return Object.fromEntries(TEXT_KEYS.map((k) => [k, plan[k]]));
}
