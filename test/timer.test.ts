// services/timer: the plan sent to the Android timer module, and its buttons (Stop, Resume, end break).
import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { planNotifications } from '../src/core/notificationPlan.ts';
import { appData, captureWarnings, freeze, HOUR, MIN, SEC, T0, world } from './helpers/world.mjs';

const TEXT = {
  nextTitle: 'Next break in',
  nextAtTitle: 'Next break at %s',
  breakTitle: 'Eye break',
  stopLabel: 'Stop',
  stoppedTitle: 'Reminders stopped',
  stoppedText: 'No break reminders until you resume.',
  resumeLabel: 'Resume',
  channelName: 'Timer',
};
const OFF = { ...TEXT, enabled: false, paused: false, breakEndsAt: 0, overId: '', reminders: [], refillAt: 0 };

async function setup(t: TestContext, data = appData(), opts: Record<string, unknown> = {}) {
  freeze(t, T0);
  const w = await world({ data, ...opts });
  const timer = await w.load('services/timer');
  const storage = await w.load('services/storage');
  return { w, timer, storage };
}

describe('updateTimer: the plan JSON', () => {
  it('null: everything off', async (t) => {
    const { w, timer } = await setup(t);
    timer.updateTimer(null);
    assert.deepEqual(w.native.lastPlan, OFF);
  });

  it('is a JSON string with exactly the fields TimerPlan declares', async (t) => {
    const { w, timer } = await setup(t);
    timer.updateTimer(null);
    assert.equal(typeof w.native.rawPlans[0], 'string');
    assert.deepEqual(Object.keys(JSON.parse(w.native.rawPlans[0])).sort(), Object.keys(OFF).sort());
  });

  it('not onboarded: everything off', async (t) => {
    const { w, timer } = await setup(t);
    timer.updateTimer(appData({ onboarded: false, timer: { anchor: T0, setAt: T0, breakEndsAt: T0 + 20 * SEC } }), [], 99);
    assert.deepEqual(w.native.lastPlan, OFF);
  });

  it('waiting: on, with the reminder times only (not the last call), and the refill time', async (t) => {
    const { w, timer } = await setup(t);
    const data = appData();
    const planned = planNotifications(data, T0, 5);
    timer.updateTimer(data, planned, T0 + HOUR);
    assert.deepEqual(w.native.lastPlan, {
      ...TEXT,
      enabled: true,
      paused: false,
      breakEndsAt: 0,
      overId: '',
      reminders: [1, 2, 3, 4, 5].map((k) => T0 + k * 20 * MIN),
      refillAt: T0 + HOUR,
    });
  });

  it('during a break: its end and the id of its break-over notification', async (t) => {
    const { w, timer } = await setup(t);
    const data = appData({ timer: { anchor: T0 + 20 * SEC, setAt: T0, breakEndsAt: T0 + 20 * SEC } });
    const planned = planNotifications(data, T0, 3);
    timer.updateTimer(data, planned, 0);
    assert.equal(w.native.lastPlan.breakEndsAt, T0 + 20 * SEC);
    assert.equal(w.native.lastPlan.overId, planned.find((n) => n.kind === 'over')!.id);
    assert.ok(w.native.lastPlan.overId.startsWith('over_'));
    assert.equal(w.native.lastPlan.reminders.length, 3);
  });

  it('stopped: paused, no reminders', async (t) => {
    const { w, timer } = await setup(t);
    const data = appData({ timer: { anchor: T0, setAt: T0, breakEndsAt: null, paused: true } });
    timer.updateTimer(data, planNotifications(data, T0), 0);
    assert.equal(w.native.lastPlan.paused, true);
    assert.equal(w.native.lastPlan.enabled, true);
    assert.deepEqual(w.native.lastPlan.reminders, []);
  });

  it('tray timer turned off: not shown, but reminders (to tidy the tray) and the refill still go to the native side', async (t) => {
    const { w, timer } = await setup(t);
    const data = appData({ settings: { trayTimer: false } });
    timer.updateTimer(data, planNotifications(data, T0, 2), T0 + 2 * HOUR);
    assert.equal(w.native.lastPlan.enabled, false);
    assert.equal(w.native.lastPlan.reminders.length, 2);
    assert.equal(w.native.lastPlan.refillAt, T0 + 2 * HOUR);
  });

  it('no native module (iOS, old builds): nothing happens', async (t) => {
    const { w, timer } = await setup(t, appData(), { os: 'ios' });
    assert.equal(timer.timerAvailable, false);
    timer.updateTimer(appData(), [], 0);
    assert.equal(w.native, null);
  });

  it('a native error is reported, not thrown', async (t) => {
    const { w, timer } = await setup(t);
    const warnings = captureWarnings(t);
    w.native.setPlanError = new Error('ReactContextLost');
    timer.updateTimer(null);
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]![0]), /Could not update the timer notification/);
  });
});

describe('applyTimerActions', () => {
  const RUNNING = { anchor: T0 + 20 * SEC, setAt: T0, breakEndsAt: T0 + 20 * SEC };

  it('Stop stops reminders, from the time it was pressed', async (t) => {
    const { w, timer, storage } = await setup(t);
    w.native.pendingActions.push({ type: 'stop', at: T0 - 2 * MIN });
    timer.applyTimerActions();
    assert.deepEqual(storage.getData().timer, { anchor: T0 - 2 * MIN, setAt: T0 - 2 * MIN, breakEndsAt: null, paused: true });
    assert.equal(w.saved().timer.paused, true, 'saved');
  });

  it('Resume starts reminders again from the time it was pressed', async (t) => {
    const { w, timer, storage } = await setup(t, appData({ timer: { anchor: T0 - HOUR, setAt: T0 - HOUR, breakEndsAt: null, paused: true } }));
    w.native.pendingActions.push({ type: 'resume', at: T0 - MIN });
    timer.applyTimerActions();
    assert.deepEqual(storage.getData().timer, { anchor: T0 - MIN, setAt: T0 - MIN, breakEndsAt: null });
  });

  it('Stop during a break (endBreak) ends the break without counting it', async (t) => {
    const { w, timer, storage } = await setup(t, appData({ timer: RUNNING }));
    w.native.pendingActions.push({ type: 'endBreak', at: T0 + 5 * SEC });
    timer.applyTimerActions();
    const d = storage.getData();
    assert.deepEqual(d.timer, { anchor: T0 + 5 * SEC, setAt: T0 + 5 * SEC, breakEndsAt: null });
    assert.deepEqual(d.days, {});
  });

  it('endBreak after the break was over counts it first', async (t) => {
    const { w, timer, storage } = await setup(t, appData({ timer: RUNNING }));
    w.native.pendingActions.push({ type: 'endBreak', at: T0 + 30 * SEC });
    timer.applyTimerActions();
    assert.deepEqual(storage.getData().days, { '2026-10-26': 1 });
  });

  it('applies several presses in order: stop then resume ends running', async (t) => {
    const { w, timer, storage } = await setup(t);
    w.native.pendingActions.push({ type: 'stop', at: T0 - 3 * MIN }, { type: 'resume', at: T0 - 2 * MIN });
    timer.applyTimerActions();
    assert.deepEqual(storage.getData().timer, { anchor: T0 - 2 * MIN, setAt: T0 - 2 * MIN, breakEndsAt: null });
  });

  it('applies several presses in order: resume then stop ends stopped', async (t) => {
    const { w, timer, storage } = await setup(t);
    w.native.pendingActions.push({ type: 'resume', at: T0 - 3 * MIN }, { type: 'stop', at: T0 - 2 * MIN });
    timer.applyTimerActions();
    assert.equal(storage.getData().timer.paused, true);
  });

  it('a break ended, then reminders stopped: both in order', async (t) => {
    const { w, timer, storage } = await setup(t, appData({ timer: RUNNING }));
    w.native.pendingActions.push({ type: 'endBreak', at: T0 + 5 * SEC }, { type: 'stop', at: T0 + 6 * SEC });
    timer.applyTimerActions();
    assert.deepEqual(storage.getData().timer, { anchor: T0 + 6 * SEC, setAt: T0 + 6 * SEC, breakEndsAt: null, paused: true });
  });

  it('each press is applied once', async (t) => {
    const { w, timer, storage } = await setup(t);
    w.native.pendingActions.push({ type: 'stop', at: T0 - 3 * MIN });
    timer.applyTimerActions();
    const after = storage.getData();
    w.disk.takeLog();
    timer.applyTimerActions();
    assert.equal(storage.getData(), after);
    assert.deepEqual(w.disk.takeLog(), [], 'nothing written');
  });

  it('unknown action types and unreadable JSON are ignored', async (t) => {
    const { w, timer, storage } = await setup(t);
    const before = storage.getData();
    w.native.rawActions = JSON.stringify([{ type: 'explode', at: T0 }]);
    timer.applyTimerActions();
    w.native.rawActions = 'not json';
    timer.applyTimerActions();
    w.native.rawActions = '{"type":"stop"}';
    timer.applyTimerActions();
    w.native.takeActionsError = new Error('native crash');
    timer.applyTimerActions();
    assert.equal(storage.getData(), before);
  });

  it('no native module: nothing to apply', async (t) => {
    const { timer, storage } = await setup(t, appData(), { timer: false });
    const before = storage.getData();
    timer.applyTimerActions();
    assert.equal(storage.getData(), before);
  });

  it('onTimerAction forwards native button events and unsubscribes', async (t) => {
    const { w, timer } = await setup(t);
    let calls = 0;
    const off = timer.onTimerAction(() => calls++);
    w.native.__emit('onAction');
    off();
    w.native.__emit('onAction');
    assert.equal(calls, 1);
  });
});
