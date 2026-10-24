// applyResponse: taps on a notification or its buttons, live or replayed at launch, fresh or stale;
// applied once; and how the kind is read (data, dataString, id prefix).
import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { appData, DEFAULT_ACTION, freeze, MIN, response, SEC, T0, world } from './helpers/world.mjs';

const START = 'start_break';
const SNOOZE = 'snooze';

async function setup(t: TestContext, opts: Record<string, unknown> = {}) {
  const clock = freeze(t, T0);
  const w = await world({ data: appData(), ...opts });
  const N = await w.load('services/notifications');
  const storage = await w.load('services/storage');
  return { w, N, storage, clock };
}

/** The timer after a break started at T0, a snooze at T0, or nothing. */
const BREAK = { anchor: T0 + 20 * SEC, setAt: T0, breakEndsAt: T0 + 20 * SEC };
const SNOOZED = { anchor: T0 - 15 * MIN, setAt: T0, breakEndsAt: null, snoozed: true };
const UNCHANGED = { anchor: T0, setAt: T0, breakEndsAt: null };

describe('applyResponse: every kind x action x live/replay x fresh/stale', () => {
  const KINDS = ['due', 'test', 'over', 'out', 'preview', 'unknown'] as const;
  const ACTIONS = [
    ['Start', START],
    ['Snooze', SNOOZE],
    ['tap', DEFAULT_ACTION],
  ] as const;
  for (const kind of KINDS) {
    for (const [actionName, action] of ACTIONS) {
      for (const live of [true, false]) {
        for (const fresh of [true, false]) {
          // Only a reminder (or the test reminder) can start a break or snooze. A replay at launch
          // counts only if recent; a button pressed just now counts however old its notification.
          const button = action !== DEFAULT_ACTION;
          const applies = (kind === 'due' || kind === 'test') && (fresh || (live && button));
          const expected = !applies ? 'home' : action === SNOOZE ? 'none' : 'break';
          const name = `${kind} / ${actionName} / ${live ? 'live' : 'replayed'} / ${fresh ? 'fresh' : 'stale'} -> ${expected}`;
          it(name, async (t) => {
            const { w, N, storage } = await setup(t);
            const id = kind === 'unknown' ? 'weather_123' : `${kind}_${T0 - MIN}_fp`;
            const r = response({
              id,
              kind: kind === 'unknown' ? 'weather' : kind,
              action,
              date: fresh ? T0 - 29 * MIN : T0 - 31 * MIN,
            });
            assert.equal(N.applyResponse(r, live), expected);
            const d = storage.getData();
            assert.deepEqual(d.timer, expected === 'break' ? BREAK : expected === 'none' ? SNOOZED : UNCHANGED);
            assert.deepEqual(d.handled, [`${id}|${action}`]);
            assert.deepEqual(w.notif.state.dismissed, [id]);
            // Saved, so other processes (the background task) see it.
            assert.deepEqual(w.saved().handled, [`${id}|${action}`]);
          });
        }
      }
    }
  }
});

describe('applyResponse: details', () => {
  it('a notification exactly 30 minutes old is stale', async (t) => {
    const { N } = await setup(t);
    assert.equal(N.applyResponse(response({ date: T0 - 30 * MIN }), false), 'home');
  });

  it('dates in seconds (as some platforms report them) are understood', async (t) => {
    const { N } = await setup(t);
    assert.equal(N.applyResponse(response({ id: 'due_a', date: (T0 - 1 * MIN) / 1000 }), false), 'break');
    const { N: N2 } = await setup2(t);
    assert.equal(N2.applyResponse(response({ id: 'due_b', date: (T0 - 31 * MIN) / 1000 }), false), 'home');
  });

  it('the same response is applied once: a repeat returns none and changes nothing', async (t) => {
    const { N, storage } = await setup(t);
    const r = response({ action: SNOOZE });
    assert.equal(N.applyResponse(r, true), 'none');
    const after = storage.getData();
    assert.equal(N.applyResponse(r, true), 'none');
    assert.equal(N.applyResponse(r, false), 'none');
    assert.equal(storage.getData(), after, 'no new state');
  });

  it('a Start repeat after the break ended does not start a second break', async (t) => {
    const { N, storage, clock } = await setup(t);
    const r = response({ action: START });
    assert.equal(N.applyResponse(r, true), 'break');
    clock.set(T0 + MIN);
    assert.equal(N.applyResponse(r, true), 'none');
    assert.equal(storage.getData().timer.breakEndsAt, T0 + 20 * SEC);
  });

  it('different buttons on the same notification are separate responses', async (t) => {
    const { N } = await setup(t);
    assert.equal(N.applyResponse(response({ action: SNOOZE }), true), 'none');
    assert.equal(N.applyResponse(response({ action: START }), true), 'break');
  });

  it('a response handled in another process (saved to disk) is not applied again', async (t) => {
    const { w, N } = await setup(t);
    const r = response({ action: SNOOZE });
    N.applyResponse(r, true);
    t.mock.timers.reset();
    const { N: N2, storage: s2 } = await setup(t, { data: w.saved() });
    assert.equal(N2.applyResponse(r, false), 'none');
    assert.equal(s2.getData().timer.snoozed, true);
  });

  it('only the last 30 handled responses are kept', async (t) => {
    const { N, storage } = await setup(t);
    for (let i = 0; i < 35; i++) N.applyResponse(response({ id: `out_${i}`, kind: 'out' }), true);
    const { handled } = storage.getData();
    assert.equal(handled.length, 30);
    assert.equal(handled[0], `out_5|${DEFAULT_ACTION}`);
    assert.equal(handled[29], `out_34|${DEFAULT_ACTION}`);
  });

  it('Start during a running break keeps that break and still opens it', async (t) => {
    const { N, storage, clock } = await setup(t);
    N.applyResponse(response({ id: 'due_1', action: START }), true);
    clock.set(T0 + 5 * SEC);
    assert.equal(N.applyResponse(response({ id: 'due_2', action: START }), true), 'break');
    assert.equal(storage.getData().timer.breakEndsAt, T0 + 20 * SEC);
  });

  it('Snooze books the next reminder snoozeMin from now', async (t) => {
    const { w, N } = await setup(t);
    N.applyResponse(response({ action: SNOOZE }), true);
    await N.syncSchedule();
    const first = w.notif.scheduled().find((r: { identifier: string }) => r.identifier.startsWith('due_'));
    assert.equal(first.trigger.timestamp, T0 + 5 * MIN);
  });
});

describe('the kind of a notification', () => {
  const cases: [string, Parameters<typeof response>[0], string][] = [
    ['from content.data', { id: 'x1', kind: 'due', payload: 'data' }, 'break'],
    ['from dataString (Android background task)', { id: 'x2', kind: 'due', payload: 'dataString' }, 'break'],
    ['from dataString for a test reminder', { id: 'x3', kind: 'test', payload: 'dataString' }, 'break'],
    ['from the id prefix when there is no data', { id: 'due_1_fp', payload: 'none' }, 'break'],
    ['from the test_ id prefix', { id: 'test_123', payload: 'none' }, 'break'],
    ['an unknown id prefix is not ours', { id: 'promo_1', payload: 'none' }, 'home'],
    ['a null data.kind falls back to the id prefix', { id: 'due_7', payload: 'none', content: { data: { kind: null } } }, 'break'],
    ['data wins over the id prefix', { id: 'due_1', kind: 'over', payload: 'data' }, 'home'],
    ['dataString wins over the id prefix', { id: 'over_1', kind: 'due', payload: 'dataString' }, 'break'],
  ];
  for (const [name, r, expected] of cases) {
    it(`${name} -> ${expected}`, async (t) => {
      const { N } = await setup(t);
      assert.equal(N.applyResponse(response({ action: START, ...r }), false), expected);
    });
  }

  it('dataString that is not JSON falls back to the id prefix', async (t) => {
    const { N } = await setup(t);
    const r = response({ id: 'due_9', payload: 'none', action: START, content: { dataString: 'not json{' } });
    assert.equal(N.applyResponse(r, true), 'break');
  });

  it('dataString of JSON null or a number falls back to the id prefix', async (t) => {
    const { N } = await setup(t);
    for (const [i, s] of ['null', '42'].entries()) {
      const r = response({ id: `due_${i}`, payload: 'none', action: START, content: { dataString: s } });
      assert.equal(N.applyResponse(r, true), 'break', s);
    }
  });

  it('empty content.data falls through to dataString', async (t) => {
    const { N } = await setup(t);
    const r = response({ id: 'zz', payload: 'none', action: START, content: { data: {}, dataString: '{"kind":"due"}' } });
    assert.equal(N.applyResponse(r, true), 'break');
  });
});

async function setup2(t: TestContext) {
  t.mock.timers.reset();
  return setup(t);
}
