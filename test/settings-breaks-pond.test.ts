// services/settings (the debounced sync), services/breaks and services/pond.
import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { appData, flush, freeze, MIN, SEC, T0, world } from './helpers/world.mjs';

async function setup(t: TestContext, data = appData(), timers = false) {
  const clock = freeze(t, T0, { timers });
  const w = await world({ data });
  const N = await w.load('services/notifications');
  const storage = await w.load('services/storage');
  /** Each sync starts by checking the permission. */
  const syncs = () => w.notif.callsOf('getPermissionsAsync').length;
  const firstReminder = () =>
    Math.min(...w.notif.scheduled().filter((r: { identifier: string }) => r.identifier.startsWith('due_')).map((r: { trigger: { timestamp: number } }) => r.trigger.timestamp));
  return { w, N, storage, clock, syncs, firstReminder };
}

describe('saveSettings', () => {
  it('saves at once, and syncs 600 ms later', async (t) => {
    const { w, clock, syncs } = await setup(t, appData(), true);
    const settings = await w.load('services/settings');
    settings.saveSettings({ snoozeMin: 10 });
    assert.equal(w.saved().settings.snoozeMin, 10, 'saved before any sync');
    clock.tick(599);
    await flush();
    assert.equal(syncs(), 0);
    clock.tick(1);
    await flush();
    assert.equal(syncs(), 1);
    assert.equal(w.notif.state.categories.get('break_due').actions[1].buttonTitle, 'Snooze 10 min');
  });

  it('taps in quick succession sync once, 600 ms after the last', async (t) => {
    const { w, clock, syncs } = await setup(t, appData(), true);
    const settings = await w.load('services/settings');
    settings.saveSettings({ snoozeMin: 10 });
    clock.tick(400);
    settings.saveSettings({ snoozeMin: 15 });
    clock.tick(400);
    await flush();
    assert.equal(syncs(), 0, 'the first timer was replaced');
    clock.tick(200);
    await flush();
    assert.equal(syncs(), 1);
    assert.equal(w.notif.state.categories.get('break_due').actions[1].buttonTitle, 'Snooze 15 min');
  });

  it('sync: false saves without syncing', async (t) => {
    const { w, clock, syncs } = await setup(t, appData(), true);
    const settings = await w.load('services/settings');
    settings.saveSettings({ startSound: 'bell' }, { sync: false });
    assert.equal(w.saved().settings.startSound, 'bell');
    clock.tick(5000);
    await flush();
    assert.equal(syncs(), 0);
  });

  it('sync: false leaves a sync already due from an earlier change, which then includes both', async (t) => {
    const { w, clock, syncs } = await setup(t, appData(), true);
    const settings = await w.load('services/settings');
    settings.saveSettings({ snoozeMin: 10 });
    clock.tick(300);
    settings.saveSettings({ startSound: 'bell' }, { sync: false });
    clock.tick(300);
    await flush();
    assert.equal(syncs(), 1);
    assert.equal(w.notif.scheduled()[0].content.sound, 'bell.wav');
  });

  it('a new reminder interval counts from the moment it is saved', async (t) => {
    const { w, clock, N, firstReminder } = await setup(t, appData(), true);
    const settings = await w.load('services/settings');
    clock.tick(7 * MIN);
    settings.saveSettings({ rule202020: false, workMin: 30 }, { sync: false });
    await N.syncSchedule();
    assert.equal(firstReminder(), T0 + 7 * MIN + 30 * MIN);
  });
});

describe('break actions', () => {
  it('beginBreak starts a break and books its end', async (t) => {
    const { w } = await setup(t);
    const breaks = await w.load('services/breaks');
    breaks.beginBreak();
    assert.equal(w.saved().timer.breakEndsAt, T0 + 20 * SEC);
    await flush();
    assert.ok(w.notif.scheduledIds().some((id: string) => id.startsWith(`over_${T0 + 20 * SEC}_`)));
  });

  it('completeBreakIfDone: false while the break runs, true once when it is over (counted), then false', async (t) => {
    const { w, clock, storage } = await setup(t);
    const breaks = await w.load('services/breaks');
    breaks.beginBreak();
    clock.set(T0 + 10 * SEC);
    assert.equal(breaks.completeBreakIfDone(), false);
    clock.set(T0 + 20 * SEC);
    assert.equal(breaks.completeBreakIfDone(), true);
    assert.equal(breaks.completeBreakIfDone(), false);
    const d = storage.getData();
    assert.deepEqual(d.days, { '2026-10-26': 1 });
    assert.equal(d.pond.total, 1);
    assert.deepEqual(w.saved().days, { '2026-10-26': 1 });
  });

  it('completeBreakIfDone with no break: false, nothing written', async (t) => {
    const { w } = await setup(t);
    const breaks = await w.load('services/breaks');
    w.disk.takeLog();
    assert.equal(breaks.completeBreakIfDone(), false);
    assert.ok(!w.disk.takeLog().some((l: string) => l.startsWith('writeSync')));
  });

  it('skipNow during a break: not counted, reminders count from now, the break-over alert is cancelled', async (t) => {
    const { w, clock, firstReminder } = await setup(t);
    const breaks = await w.load('services/breaks');
    breaks.beginBreak();
    await flush();
    clock.set(T0 + 5 * SEC);
    breaks.skipNow();
    await flush();
    assert.deepEqual(w.saved().days, {});
    assert.equal(w.notif.scheduledIds().filter((id: string) => id.startsWith('over_')).length, 0);
    assert.equal(firstReminder(), T0 + 5 * SEC + 20 * MIN);
  });

  it('snoozeNow: the next reminder in the snooze length', async (t) => {
    const { w, firstReminder } = await setup(t, appData({ settings: { snoozeMin: 10 } }));
    const breaks = await w.load('services/breaks');
    breaks.snoozeNow();
    await flush();
    assert.equal(firstReminder(), T0 + 10 * MIN);
  });

  it('resumeNow after Stop: reminders are booked again', async (t) => {
    const { w, firstReminder } = await setup(t, appData({ timer: { anchor: T0, setAt: T0, breakEndsAt: null, paused: true } }));
    const breaks = await w.load('services/breaks');
    breaks.resumeNow();
    await flush();
    assert.equal(w.saved().timer.paused, undefined);
    assert.equal(firstReminder(), T0 + 20 * MIN);
  });
});

describe('pond actions', () => {
  const pond = (total: number, extra: Record<string, unknown> = {}) =>
    appData({ pond: { total, lastAt: 0, name: 'Pip', wearing: null, seen: total, ...extra } });

  it('wearNow: an unlocked hat goes on, and off again; a locked one is ignored without writing', async (t) => {
    const { w } = await setup(t, pond(45));
    const p = await w.load('services/pond');
    p.wearNow('beanie');
    assert.equal(w.saved().pond.wearing, 'beanie');
    p.wearNow('beanie');
    assert.equal(w.saved().pond.wearing, null);
    w.disk.takeLog();
    p.wearNow('scarf');
    assert.deepEqual(w.disk.takeLog(), []);
  });

  it('renameNow saves a cleaned-up name, never an empty one', async (t) => {
    const { w } = await setup(t, pond(3));
    const p = await w.load('services/pond');
    p.renameNow('  Sir   Quacks​ a lot  ');
    assert.equal(w.saved().pond.name, 'Sir Quacks a lot');
    p.renameNow('   ');
    assert.equal(w.saved().pond.name, 'Pip');
  });

  it('markPondSeenNow marks new finds as seen; with nothing new it writes nothing', async (t) => {
    const { w } = await setup(t, pond(21, { seen: 4 }));
    const p = await w.load('services/pond');
    p.markPondSeenNow();
    assert.equal(w.saved().pond.seen, 21);
    w.disk.takeLog();
    p.markPondSeenNow();
    assert.deepEqual(w.disk.takeLog(), []);
  });
});
