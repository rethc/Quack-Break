// services/backgroundTask: Snooze/Start pressed with the app closed (Android), and the refill alarm.
import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { appData, captureWarnings, DEFAULT_ACTION, freeze, HOUR, MIN, response, SEC, T0, world } from './helpers/world.mjs';

const TASK = 'quack-notification-actions';
const NEW_DATA = 0;
const NO_DATA = 1;

async function setup(t: TestContext, opts: Record<string, unknown> = {}) {
  freeze(t, T0);
  const w = await world({ data: appData(), ...opts });
  await w.load('services/backgroundTask');
  const run = (data: unknown, error: unknown = null) => w.taskManager.__run(TASK, { data, error });
  const syncs = () => w.notif.callsOf('getAllScheduledNotificationsAsync').length;
  return { w, run, syncs };
}

/** A button press as the Android task receives it: content.dataString, no content.data. */
const press = (action: string, extra: Record<string, unknown> = {}) =>
  response({ id: `due_${T0 - MIN}_fp`, kind: 'due', action, date: T0 - MIN, payload: 'dataString', ...extra });

describe('background task: setup', () => {
  it('Android: defines the task and registers it with expo-notifications', async (t) => {
    const { w } = await setup(t);
    assert.ok(w.taskManager.isTaskDefined(TASK));
    assert.deepEqual(w.notif.state.registeredTasks, [TASK]);
  });

  it('iOS: defines and registers nothing', async (t) => {
    const { w } = await setup(t, { os: 'ios' });
    assert.equal(w.taskManager.tasks.size, 0);
    assert.deepEqual(w.notif.callsOf('registerTaskAsync'), []);
  });

  it('a failing registration is reported, not thrown', async (t) => {
    freeze(t, T0);
    const w = await world({ data: appData() });
    const warnings = captureWarnings(t);
    w.notif.state.registerTaskError = new Error('TaskManager unavailable');
    await w.load('services/backgroundTask');
    await new Promise((r) => setImmediate(r));
    assert.ok(warnings.some(([m]) => /Could not register notification task/.test(String(m))));
  });
});

describe('background task: payloads', () => {
  it('an error or no data: NoData, and nothing happens', async (t) => {
    const { w, run, syncs } = await setup(t);
    assert.equal(await run(press('snooze'), new Error('boom')), NO_DATA);
    assert.equal(await run(null), NO_DATA);
    assert.equal(syncs(), 0);
    assert.equal(w.saved().timer.snoozed, undefined);
  });

  it('Snooze (dataString payload): snoozes, saves, and books the next reminder in 5 min', async (t) => {
    const { w, run } = await setup(t);
    assert.equal(await run(press('snooze')), NEW_DATA);
    const saved = w.saved();
    assert.equal(saved.timer.snoozed, true);
    assert.deepEqual(saved.handled, [`due_${T0 - MIN}_fp|snooze`]);
    const first = w.notif.scheduled().find((r: { identifier: string }) => r.identifier.startsWith('due_'));
    assert.equal(first.trigger.timestamp, T0 + 5 * MIN);
    assert.deepEqual(w.notif.state.dismissed, [`due_${T0 - MIN}_fp`]);
  });

  it('Start: starts the break (it runs in the tray timer) and books its end', async (t) => {
    const { w, run } = await setup(t);
    assert.equal(await run(press('start_break')), NEW_DATA);
    assert.equal(w.saved().timer.breakEndsAt, T0 + 20 * SEC);
    assert.ok(w.notif.scheduledIds().some((id: string) => id.startsWith('over_')));
    assert.equal(w.native.lastPlan.breakEndsAt, T0 + 20 * SEC);
  });

  it("a button on an hours-old reminder still counts (it was pressed just now)", async (t) => {
    const { w, run } = await setup(t);
    await run(press('snooze', { date: T0 - 3 * HOUR }));
    assert.equal(w.saved().timer.snoozed, true);
  });

  it('a plain tap is left to the app: NoData, nothing saved, no sync', async (t) => {
    const { w, run, syncs } = await setup(t);
    w.disk.takeLog();
    assert.equal(await run(press(DEFAULT_ACTION)), NO_DATA);
    assert.equal(syncs(), 0);
    assert.ok(!w.disk.takeLog().some((l: string) => l.startsWith('writeSync')));
  });

  it('an unknown button: NoData', async (t) => {
    const { run, syncs } = await setup(t);
    assert.equal(await run(press('reply')), NO_DATA);
    assert.equal(syncs(), 0);
  });

  it('a notification received (not a response): NoData', async (t) => {
    const { run, syncs } = await setup(t);
    assert.equal(await run({ notification: null, data: { dataString: '{"kind":"due"}' } }), NO_DATA);
    assert.equal(syncs(), 0);
  });

  it('the refill alarm ({ quackRefill: true }): syncs and books ahead, applying no response', async (t) => {
    const { w, run, syncs } = await setup(t);
    assert.equal(await run({ quackRefill: true }), NEW_DATA);
    assert.equal(syncs(), 1);
    assert.equal(w.notif.scheduledIds().filter((id: string) => id.startsWith('due_')).length, 150);
    assert.equal(w.notif.callsOf('dismissNotificationAsync').length, 0);
    assert.equal(w.native.lastPlan.refillAt, T0 + 12 * HOUR);
  });

  for (const value of ['true', 1, false, null]) {
    it(`quackRefill must be exactly true (${JSON.stringify(value)} is ignored)`, async (t) => {
      const { run, syncs } = await setup(t);
      assert.equal(await run({ quackRefill: value }), NO_DATA);
      assert.equal(syncs(), 0);
    });
  }

  it('re-reads the saved state first (the app may have changed it since this process loaded it)', async (t) => {
    const { w, run } = await setup(t);
    const storage = await w.load('services/storage');
    assert.equal(storage.getData().settings.startSound, 'quack');
    w.disk.write('quack-state.json', JSON.stringify(appData({ settings: { startSound: 'bell' } })));
    await run({ quackRefill: true });
    assert.equal(w.notif.scheduled()[0].content.sound, 'bell.wav');
  });

  it('applies Stop pressed on the tray timer before syncing', async (t) => {
    const { w, run } = await setup(t);
    w.native.pendingActions.push({ type: 'stop', at: T0 - MIN });
    await run({ quackRefill: true });
    assert.deepEqual(w.notif.scheduledIds(), []);
    assert.equal(w.saved().timer.paused, true);
  });

  it('counts a break that ended while the app was closed', async (t) => {
    const data = appData({ timer: { anchor: T0 - MIN, setAt: T0 - 2 * MIN, breakEndsAt: T0 - MIN } });
    const { w, run } = await setup(t, { data });
    await run(press('snooze'));
    const saved = w.saved();
    assert.deepEqual(saved.days, { '2026-10-26': 1 });
    assert.equal(saved.pond.total, 1);
    assert.equal(saved.timer.snoozed, true);
  });

  it('the same press delivered twice is applied once', async (t) => {
    const { w, run, syncs } = await setup(t);
    await run(press('start_break'));
    t.mock.timers.setTime(T0 + 30 * SEC);
    assert.equal(await run(press('start_break')), NEW_DATA);
    assert.equal(syncs(), 2);
    // The break that ran T0..T0+20s is counted, and no second break was started.
    assert.equal(w.saved().timer.breakEndsAt, null);
    assert.deepEqual(w.saved().days, { '2026-10-26': 1 });
  });
});
