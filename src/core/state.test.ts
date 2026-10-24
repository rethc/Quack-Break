// Unit tests for the app state: break and pet transitions, checks on saved data, and the
// notification plan. Pure logic only, no React Native.
// Run alone with: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/core/state.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  contentFingerprint,
  MAX_REMINDERS,
  MAX_REMINDERS_ANDROID,
  OUT_BODY,
  OUT_TITLE,
  planNotifications,
  type PlannedNotification,
} from './notificationPlan.ts';
import { DEFAULT_DUCK_NAME, defaultPond, ITEMS, MAX_NAME_LENGTH, MIN_GAP_MS, type ItemId } from './pond.ts';
import { dayKey, HOUR, isQuiet, MINUTE, planBreaks } from './schedule.ts';
import { SOUND_OPTIONS, VOICE_OPTIONS } from './sounds.ts';
import {
  breaksOn,
  finishBreakIfDone,
  finishOnboarding,
  markPondSeen,
  rememberHandled,
  renameDuck,
  resumeReminders,
  skipBreak,
  snooze,
  startBreak,
  stopReminders,
  updateSettings,
  wearItem,
} from './transitions.ts';
import {
  BREAK_CHOICES,
  DEFAULT_SETTINGS,
  defaultData,
  RULE_BREAK_SEC,
  RULE_WORK_MIN,
  settingsFrom,
  SNOOZE_CHOICES,
  timerFrom,
  WORK_CHOICES,
  type AppData,
  type QuietHours,
  type Settings,
  type TimerState,
} from './types.ts';

// ---------------------------------------------------------------------------------------------
// Helpers

const SEC = 1000;

/** Local time on a day in October 2026. Days 19 to 23 are clear of DST changes in most zones. */
const at = (h: number, m = 0, day = 22, s = 0) => new Date(2026, 9, day, h, m, s).getTime();

const noQuiet: Settings = { ...DEFAULT_SETTINGS, quiet: { enabled: false, startMin: 22 * 60, endMin: 8 * 60 } };

/** Custom timings (20-20-20 rule off), no quiet hours. */
const custom = (patch: Partial<Settings>): Settings => ({ ...noQuiet, rule202020: false, ...patch });

/** Onboarded data whose cadence starts at `t`. */
function ready(settings: Settings = noQuiet, t = at(9)): AppData {
  return { ...finishOnboarding(defaultData(t), t), settings };
}

/** Data with a break that ended at `endsAt` and that no transition has counted yet (taken from a notification). */
function breakEndedAt(endsAt: number, base: AppData = ready()): AppData {
  return startBreak(base, endsAt - base.settings.breakSec * SEC);
}

/** Data whose pond has `total` breaks, all seen. */
function pondWith(total: number, wearing: ItemId | null = null): AppData {
  return { ...ready(), pond: { ...defaultPond(), total, seen: total, wearing } };
}

const daysAgo = (i: number) => dayKey(new Date(2026, 9, 22 - i, 12).getTime());

/** One break on each of the `n` days before Oct 22. */
function pastDays(n: number): Record<string, number> {
  const days: Record<string, number> = {};
  for (let i = 1; i <= n; i++) days[daysAgo(i)] = 1;
  return days;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

const frozenCopy = <T>(value: T): T => deepFreeze(structuredClone(value));

/** Seeded PRNG, so the property tests run the same every time. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickOne = <T>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const randInt = (rand: () => number, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

const SOUND_IDS = SOUND_OPTIONS.map((o) => o.value);
const VOICE_IDS = VOICE_OPTIONS.map((o) => o.value);

const ofKind = (plan: PlannedNotification[], kind: PlannedNotification['kind']) => plan.filter((n) => n.kind === kind);

// ---------------------------------------------------------------------------------------------

describe('finishBreakIfDone', () => {
  it('returns the same object when no break was started', () => {
    const d = ready();
    assert.equal(finishBreakIfDone(d, at(10)), d);
  });

  it('returns the same object while the break is still running, up to 1 ms before it ends', () => {
    const d = startBreak(ready(), at(10));
    assert.equal(finishBreakIfDone(d, at(10)), d);
    assert.equal(finishBreakIfDone(d, at(10) + 20 * SEC - 1), d);
  });

  it('counts a break that ends exactly now', () => {
    const d = finishBreakIfDone(startBreak(ready(), at(10)), at(10) + 20 * SEC);
    assert.deepEqual(d.days, { '2026-10-22': 1 });
    assert.equal(d.timer.breakEndsAt, null);
  });

  it('counts a finished break only once, then returns the same object', () => {
    const once = finishBreakIfDone(breakEndedAt(at(10)), at(10, 5));
    assert.equal(finishBreakIfDone(once, at(10, 6)), once);
    assert.deepEqual(once.days, { '2026-10-22': 1 });
    assert.equal(once.pond.total, 1);
  });

  it('counts the break on the local day it ended, not the day it is noticed', () => {
    const d = finishBreakIfDone(breakEndedAt(at(23, 59, 22, 59)), at(8, 0, 23));
    assert.deepEqual(d.days, { '2026-10-22': 1 });
    assert.equal(breaksOn(d, at(8, 0, 23)), 0);
  });

  it('adds to the count already recorded for that day', () => {
    const base = { ...ready(), days: { '2026-10-21': 4, '2026-10-22': 2 } };
    const d = finishBreakIfDone(breakEndedAt(at(15), base), at(15, 1));
    assert.deepEqual(d.days, { '2026-10-21': 4, '2026-10-22': 3 });
  });

  it('clears the finished break but keeps the cadence and a stopped state', () => {
    const running = startBreak(stopReminders(ready(), at(9, 30)), at(10));
    const d = finishBreakIfDone(running, at(10, 1));
    assert.deepEqual(d.timer, { anchor: at(10) + 20 * SEC, setAt: at(10), breakEndsAt: null, paused: true });
  });

  it('counts the break toward the pond, remembering when it ended', () => {
    const d = finishBreakIfDone(breakEndedAt(at(10)), at(10, 5));
    assert.deepEqual(d.pond, { ...defaultPond(), total: 1, lastAt: at(10) });
  });

  it('does not grow the pond for a break ending under 5 minutes after the last counted one, but counts it today', () => {
    const base = { ...ready(), pond: { ...defaultPond(), total: 7, seen: 7, lastAt: at(10) } };
    const d = finishBreakIfDone(breakEndedAt(at(10) + MIN_GAP_MS - 1, base), at(10, 30));
    assert.deepEqual(d.pond, base.pond);
    assert.equal(breaksOn(d, at(10)), 1);
  });

  it('grows the pond for a break ending exactly 5 minutes after the last counted one', () => {
    const base = { ...ready(), pond: { ...defaultPond(), total: 7, seen: 7, lastAt: at(10) } };
    const d = finishBreakIfDone(breakEndedAt(at(10) + MIN_GAP_MS, base), at(10, 30));
    assert.deepEqual(d.pond, { ...base.pond, total: 8, lastAt: at(10) + MIN_GAP_MS });
  });

  it('keeps the newest 400 days, dropping the oldest when a 401st day is added', () => {
    const base = { ...ready(), days: pastDays(400) };
    const d = finishBreakIfDone(breakEndedAt(at(10), base), at(10, 1));
    assert.equal(Object.keys(d.days).length, 400);
    assert.equal(d.days['2026-10-22'], 1);
    assert.equal(daysAgo(400) in d.days, false);
    assert.equal(d.days[daysAgo(399)], 1);
  });

  it('keeps all 400 days when the break adds to a day already recorded', () => {
    const base = { ...ready(), days: { ...pastDays(399), '2026-10-22': 3 } };
    const d = finishBreakIfDone(breakEndedAt(at(10), base), at(10, 1));
    assert.equal(Object.keys(d.days).length, 400);
    assert.equal(d.days['2026-10-22'], 4);
    assert.equal(d.days[daysAgo(399)], 1);
  });

  it('trims a longer saved history down to the newest 400 days', () => {
    const base = { ...ready(), days: pastDays(450) };
    const d = finishBreakIfDone(breakEndedAt(at(10), base), at(10, 1));
    assert.equal(Object.keys(d.days).length, 400);
    assert.equal(d.days[daysAgo(399)], 1);
    assert.equal(daysAgo(400) in d.days, false);
    assert.equal(daysAgo(450) in d.days, false);
  });

  it('leaves settings, onboarding and handled keys untouched', () => {
    const base = rememberHandled(breakEndedAt(at(10)), 'due_1');
    const d = finishBreakIfDone(base, at(10, 1));
    assert.equal(d.settings, base.settings);
    assert.equal(d.handled, base.handled);
    assert.equal(d.onboarded, true);
    assert.equal(d.v, 1);
  });
});

describe('every transition counts a break whose time is up first', () => {
  const T = at(10, 20);
  const cases: [string, (d: AppData) => AppData][] = [
    ['startBreak', (d) => startBreak(d, T)],
    ['skipBreak', (d) => skipBreak(d, T)],
    ['snooze', (d) => snooze(d, T)],
    ['stopReminders', (d) => stopReminders(d, T)],
    ['resumeReminders', (d) => resumeReminders(d, T)],
    // finishOnboarding resets the timer, so a break that ended but wasn't counted yet must be
    // counted first or it is lost.
    ['finishOnboarding', (d) => finishOnboarding(d, T)],
    // updateSettings counts a finished break first too, rather than leaving it in
    // timer.breakEndsAt to be counted later.
    ['updateSettings with a new sound', (d) => updateSettings(d, { startSound: 'chime' }, T)],
    ['updateSettings with a new interval', (d) => updateSettings(d, { rule202020: false, workMin: 30 }, T)],
  ];

  for (const [name, run] of cases) {
    it(`${name} counts it for the day and toward the pond`, () => {
      const d = run(breakEndedAt(at(10)));
      assert.equal(breaksOn(d, at(10)), 1);
      assert.equal(d.pond.total, 1);
      assert.equal(d.pond.lastAt, at(10));
    });
  }

  it('a counted break is never counted again by later transitions', () => {
    let d = breakEndedAt(at(10));
    d = snooze(d, at(10, 20));
    d = skipBreak(d, at(10, 25));
    d = resumeReminders(d, at(10, 30));
    d = stopReminders(d, at(10, 40));
    d = startBreak(d, at(11));
    assert.equal(breaksOn(d, at(10)), 1);
    assert.equal(d.pond.total, 1);
  });
});

describe('startBreak', () => {
  it('starts a break of breakSec and anchors the next reminder at its end', () => {
    const d = startBreak(ready(), at(10));
    assert.deepEqual(d.timer, { anchor: at(10) + 20 * SEC, setAt: at(10), breakEndsAt: at(10) + 20 * SEC });
    assert.equal(planBreaks(at(10), d.settings, d.timer).dueAt, at(10, 20) + 20 * SEC);
  });

  it('uses a custom break length', () => {
    const d = startBreak(ready(custom({ workMin: 30, breakSec: 90 })), at(10));
    assert.equal(d.timer.breakEndsAt, at(10) + 90 * SEC);
    assert.equal(d.timer.anchor, at(10) + 90 * SEC);
  });

  it('does not restart a running break, even 1 ms before it ends', () => {
    const d = startBreak(ready(), at(10));
    assert.equal(startBreak(d, at(10) + 1), d);
    assert.equal(startBreak(d, at(10) + 20 * SEC - 1), d);
  });

  it('starts a new break once the running one ends exactly now, counting the old one', () => {
    const d = startBreak(startBreak(ready(), at(10)), at(10) + 20 * SEC);
    assert.equal(d.timer.breakEndsAt, at(10) + 40 * SEC);
    assert.equal(breaksOn(d, at(10)), 1);
  });

  it('does not count the new break until it ends', () => {
    const d = startBreak(ready(), at(10));
    assert.deepEqual(d.days, {});
    assert.equal(d.pond.total, 0);
  });

  it('keeps reminders stopped when a break is taken by hand', () => {
    const d = startBreak(stopReminders(ready(), at(9, 30)), at(10));
    assert.equal(d.timer.paused, true);
    assert.deepEqual(planBreaks(at(10), d.settings, d.timer).reminders, []);
  });

  it('does not stop reminders that were running', () => {
    assert.equal(startBreak(ready(), at(10)).timer.paused, undefined);
  });

  it('clears a pending snooze', () => {
    const d = startBreak(snooze(ready(), at(10)), at(10, 2));
    assert.ok(!d.timer.snoozed);
  });
});

describe('skipBreak', () => {
  it('records nothing and restarts the cadence from now', () => {
    const d = skipBreak(ready(), at(10, 25));
    assert.deepEqual(d.timer, { anchor: at(10, 25), setAt: at(10, 25), breakEndsAt: null });
    assert.deepEqual(d.days, {});
    assert.equal(planBreaks(at(10, 25), d.settings, d.timer).dueAt, at(10, 45));
  });

  it('ends a running break without counting it', () => {
    const d = skipBreak(startBreak(ready(), at(10)), at(10) + 5 * SEC);
    assert.equal(d.timer.breakEndsAt, null);
    assert.deepEqual(d.days, {});
    assert.equal(d.pond.total, 0);
  });

  it('keeps reminders stopped', () => {
    const d = skipBreak(stopReminders(ready(), at(10)), at(10, 5));
    assert.equal(d.timer.paused, true);
  });

  it('clears a pending snooze', () => {
    const d = skipBreak(snooze(ready(), at(10)), at(10, 5));
    assert.ok(!d.timer.snoozed);
    assert.equal(planBreaks(at(10, 5), d.settings, d.timer).dueAt, at(10, 25));
  });
});

describe('snooze', () => {
  it('marks the timer snoozed and makes the next reminder due snoozeMin from now', () => {
    const d = snooze(ready(), at(10, 20));
    assert.equal(d.timer.snoozed, true);
    assert.equal(d.timer.breakEndsAt, null);
    assert.equal(d.timer.setAt, at(10, 20));
    assert.equal(planBreaks(at(10, 20), d.settings, d.timer).dueAt, at(10, 25));
  });

  it('uses a custom snooze length, then the usual cadence', () => {
    const d = snooze(ready(custom({ workMin: 45, snoozeMin: 15 })), at(10));
    const p = planBreaks(at(10), d.settings, d.timer, { max: 3 });
    assert.deepEqual(p.reminders, [at(10, 15), at(11), at(11, 45)]);
  });

  it('snoozing again counts from the second snooze', () => {
    const d = snooze(snooze(ready(), at(10)), at(10, 5));
    assert.equal(planBreaks(at(10, 5), d.settings, d.timer).dueAt, at(10, 10));
  });
});

describe('stopReminders and resumeReminders', () => {
  it('stopping sets paused and restarts the timer at now', () => {
    const d = stopReminders(ready(), at(10));
    assert.deepEqual(d.timer, { anchor: at(10), setAt: at(10), breakEndsAt: null, paused: true });
  });

  it('stopping ends a running break without counting it', () => {
    const d = stopReminders(startBreak(ready(), at(10)), at(10) + 5 * SEC);
    assert.equal(d.timer.breakEndsAt, null);
    assert.deepEqual(d.days, {});
  });

  it('stopping clears a pending snooze', () => {
    assert.ok(!stopReminders(snooze(ready(), at(10)), at(10, 1)).timer.snoozed);
  });

  it('plans no reminders while stopped, even hours later', () => {
    const d = stopReminders(ready(), at(10));
    const p = planBreaks(at(18), d.settings, d.timer);
    assert.deepEqual(p.reminders, []);
    assert.equal(p.overdue, false);
  });

  it('resuming clears paused and counts the cadence from now', () => {
    const d = resumeReminders(stopReminders(ready(), at(10)), at(12));
    assert.deepEqual(d.timer, { anchor: at(12), setAt: at(12), breakEndsAt: null });
    assert.deepEqual(planBreaks(at(12), d.settings, d.timer, { max: 1 }).reminders, [at(12, 20)]);
  });

  it('resuming clears a pending snooze', () => {
    assert.ok(!resumeReminders(snooze(ready(), at(10)), at(10, 1)).timer.snoozed);
  });
});

describe('finishOnboarding', () => {
  it('marks the app onboarded and starts the cadence at now', () => {
    const d = finishOnboarding(defaultData(at(8)), at(9));
    assert.equal(d.onboarded, true);
    assert.deepEqual(d.timer, { anchor: at(9), setAt: at(9), breakEndsAt: null });
  });

  it('keeps settings, history, the pond and handled keys', () => {
    const base = { ...defaultData(at(8)), settings: custom({ workMin: 45 }), days: { '2026-10-21': 3 } };
    const before = rememberHandled({ ...base, pond: { ...defaultPond(), total: 9, seen: 9 } }, 'k');
    const d = finishOnboarding(before, at(9));
    assert.equal(d.settings, before.settings);
    assert.equal(d.days, before.days);
    assert.equal(d.pond, before.pond);
    assert.equal(d.handled, before.handled);
  });
});

describe('updateSettings', () => {
  it('merges the patch into the settings', () => {
    const d = updateSettings(ready(), { endSound: 'bell', voice: 'bella' }, at(10));
    assert.deepEqual(d.settings, { ...noQuiet, endSound: 'bell', voice: 'bella' });
  });

  it('keeps the timer as it is when workMin does not change', () => {
    const base = ready();
    assert.equal(updateSettings(base, { snoozeMin: 10, breakSec: 30 }, at(10)).timer, base.timer);
  });

  it('keeps the timer when the patch repeats the current workMin', () => {
    const base = ready();
    assert.equal(updateSettings(base, { workMin: 20 }, at(10)).timer, base.timer);
  });

  it('keeps a pending snooze when only the sound changes', () => {
    const s = snooze(ready(), at(10));
    assert.deepEqual(updateSettings(s, { startSound: 'bell' }, at(10, 1)).timer, s.timer);
  });

  it('re-anchors to now when workMin changes, so no break becomes overdue at once', () => {
    const d = updateSettings(ready(custom({ workMin: 60 })), { workMin: 10 }, at(10, 30));
    assert.deepEqual(d.timer, { anchor: at(10, 30), setAt: at(10, 30), breakEndsAt: null });
    const p = planBreaks(at(10, 30), d.settings, d.timer);
    assert.equal(p.overdue, false);
    assert.equal(p.dueAt, at(10, 40));
  });

  it('re-anchors to the end of a running break, which keeps running', () => {
    const running = startBreak(ready(custom({ workMin: 30 })), at(10));
    const d = updateSettings(running, { workMin: 45 }, at(10) + 5 * SEC);
    assert.deepEqual(d.timer, { anchor: at(10) + 20 * SEC, setAt: at(10) + 5 * SEC, breakEndsAt: at(10) + 20 * SEC });
  });

  it('re-anchors to now, not to a break that already ended', () => {
    const ended = breakEndedAt(at(10), ready(custom({ workMin: 30 })));
    const d = updateSettings(ended, { workMin: 45 }, at(10, 5));
    assert.equal(d.timer.anchor, at(10, 5));
    assert.equal(d.timer.setAt, at(10, 5));
  });

  it('keeps reminders stopped when workMin changes', () => {
    const d = updateSettings(stopReminders(ready(custom({ workMin: 30 })), at(10)), { workMin: 45 }, at(10, 5));
    assert.equal(d.timer.paused, true);
    assert.deepEqual(planBreaks(at(10, 5), d.settings, d.timer).reminders, []);
  });

  it('clears a pending snooze when workMin changes, since the cadence restarts', () => {
    const d = updateSettings(snooze(ready(custom({ workMin: 30 })), at(10)), { workMin: 45 }, at(10, 1));
    assert.ok(!d.timer.snoozed);
    assert.equal(planBreaks(at(10, 1), d.settings, d.timer).dueAt, at(10, 46));
  });

  it('turning the 20-20-20 rule back on restarts the cadence at 20 minutes', () => {
    const base = ready(custom({ workMin: 45, breakSec: 60 }));
    const d = updateSettings(base, { rule202020: true, workMin: RULE_WORK_MIN, breakSec: RULE_BREAK_SEC }, at(10));
    assert.equal(d.settings.breakSec, 20);
    assert.equal(planBreaks(at(10), d.settings, d.timer).dueAt, at(10, 20));
  });
});

describe('rememberHandled and breaksOn', () => {
  it('adds a handled key to the end of the list', () => {
    const d = rememberHandled(rememberHandled(ready(), 'a'), 'b');
    assert.deepEqual(d.handled, ['a', 'b']);
  });

  it('keeps exactly the last 30 keys, dropping the oldest first', () => {
    let d = ready();
    for (let i = 0; i < 30; i++) d = rememberHandled(d, `k${i}`);
    assert.equal(d.handled.length, 30);
    assert.equal(d.handled[0], 'k0');
    for (let i = 30; i < 35; i++) d = rememberHandled(d, `k${i}`);
    assert.deepEqual(
      d.handled,
      Array.from({ length: 30 }, (_, i) => `k${i + 5}`),
    );
  });

  it('changes nothing but the handled list', () => {
    const base = breakEndedAt(at(10));
    const d = rememberHandled(base, 'x');
    assert.deepEqual({ ...d, handled: base.handled }, base);
  });

  it('breaksOn gives 0 for a day without breaks, and the count for the local day of any time in it', () => {
    const d = { ...ready(), days: { '2026-10-22': 5 } };
    assert.equal(breaksOn(d, at(0, 0)), 5);
    assert.equal(breaksOn(d, at(23, 59, 22, 59)), 5);
    assert.equal(breaksOn(d, at(0, 0, 23)), 0);
    assert.equal(breaksOn(d, at(23, 59, 21, 59)), 0);
  });
});

describe('wearItem', () => {
  it('puts on an unlocked hat', () => {
    assert.equal(wearItem(pondWith(40), 'beanie').pond.wearing, 'beanie');
  });

  it('ignores a hat that is not unlocked yet, returning the same object', () => {
    const d = pondWith(39);
    assert.equal(wearItem(d, 'beanie'), d);
  });

  it('ignores pond items even when unlocked', () => {
    const d = pondWith(200);
    for (const item of ITEMS.filter((i) => i.kind === 'pond')) assert.equal(wearItem(d, item.id), d, item.id);
  });

  it('takes the item off when it is worn again', () => {
    const d = wearItem(wearItem(pondWith(40), 'beanie'), 'beanie');
    assert.equal(d.pond.wearing, null);
  });

  it('swaps one worn item for another', () => {
    assert.equal(wearItem(pondWith(90, 'beanie'), 'bow').pond.wearing, 'bow');
  });

  it('takes the item off with null, and stays bare when nothing was worn', () => {
    assert.equal(wearItem(pondWith(90, 'bow'), null).pond.wearing, null);
    assert.equal(wearItem(pondWith(90), null).pond.wearing, null);
  });

  it('keeps the current item when asked to wear a locked or pond item', () => {
    const d = pondWith(50, 'beanie');
    assert.equal(wearItem(d, 'scarf').pond.wearing, 'beanie');
    assert.equal(wearItem(d, 'frog').pond.wearing, 'beanie');
  });

  it('makes each wearable item wearable exactly from its unlock count', () => {
    for (const item of ITEMS.filter((i) => i.kind === 'wear')) {
      const locked = pondWith(item.at - 1);
      assert.equal(wearItem(locked, item.id), locked, item.id);
      assert.equal(wearItem(pondWith(item.at), item.id).pond.wearing, item.id);
    }
  });
});

describe('renameDuck', () => {
  it('trims and collapses spaces, tabs and newlines', () => {
    assert.equal(renameDuck(ready(), '  Sir \t\n Quacks  ').pond.name, 'Sir Quacks');
  });

  it('returns the same data for an unchanged name, so leaving the pond writes nothing', () => {
    const d = renameDuck(ready(), 'Quackers');
    assert.equal(renameDuck(d, 'Quackers'), d);
    assert.equal(renameDuck(d, ' Quackers '), d);
  });

  it('falls back to the default name for an empty or blank name', () => {
    assert.equal(renameDuck(ready(), '').pond.name, DEFAULT_DUCK_NAME);
    assert.equal(renameDuck(ready(), ' \n\t ').pond.name, DEFAULT_DUCK_NAME);
  });

  it(`keeps ${MAX_NAME_LENGTH} characters and never ends on a space after cutting`, () => {
    assert.equal(renameDuck(ready(), 'x'.repeat(20)).pond.name, 'x'.repeat(20));
    assert.equal(renameDuck(ready(), 'y'.repeat(21)).pond.name, 'y'.repeat(20));
    assert.equal(renameDuck(ready(), 'Abcdefghijklmnopqrs tuvwxyz').pond.name, 'Abcdefghijklmnopqrs');
  });

  it('counts an emoji as one character, never cutting one in half', () => {
    assert.equal(renameDuck(ready(), '🦆'.repeat(25)).pond.name, '🦆'.repeat(20));
  });

  it('changes only the name', () => {
    const base = pondWith(90, 'bow');
    const d = renameDuck(base, 'Waddles');
    assert.deepEqual(d.pond, { ...base.pond, name: 'Waddles' });
    assert.equal(d.timer, base.timer);
  });
});

describe('markPondSeen', () => {
  it('returns the same object when nothing is new', () => {
    const d = pondWith(12);
    assert.equal(markPondSeen(d), d);
  });

  it('marks everything found so far as seen, and only that', () => {
    const base = { ...ready(), pond: { ...defaultPond(), total: 45, seen: 30, wearing: 'beanie' as const, lastAt: at(9) } };
    const d = markPondSeen(base);
    assert.deepEqual(d.pond, { ...base.pond, seen: 45 });
    assert.equal(markPondSeen(d), d);
  });
});

// ---------------------------------------------------------------------------------------------

const S = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...patch });
const Q = (patch: Partial<QuietHours>, rest: Partial<Settings> = {}): Settings =>
  S({ ...rest, quiet: { ...DEFAULT_SETTINGS.quiet, ...patch } });

/** [what, saved value, expected settings]. */
const SETTINGS_ROWS: [string, unknown, Settings][] = [
  // Not an object at all
  ['nothing saved (fresh install)', undefined, DEFAULT_SETTINGS],
  ['null', null, DEFAULT_SETTINGS],
  ['a JSON string instead of an object', '{"workMin":30}', DEFAULT_SETTINGS],
  ['an array', [30, 20], DEFAULT_SETTINGS],
  // Timings
  ['workMin NaN', { rule202020: false, workMin: NaN }, S({ rule202020: false })],
  ['workMin as a string', { rule202020: false, workMin: '30' }, S({ rule202020: false })],
  ['workMin not a choice (7)', { rule202020: false, workMin: 7, breakSec: 30 }, S({ rule202020: false, breakSec: 30 })],
  ['workMin negative', { rule202020: false, workMin: -20 }, S({ rule202020: false })],
  ['workMin fractional', { rule202020: false, workMin: 20.5, breakSec: 60 }, S({ rule202020: false, breakSec: 60 })],
  ['workMin Infinity', { rule202020: false, workMin: Infinity }, S({ rule202020: false })],
  ['a custom workMin with no rule flag (the rule turns off)', { workMin: 30 }, S({ rule202020: false, workMin: 30 })],
  ['custom timings with the rule on (forced to 20 and 20)', { rule202020: true, workMin: 45, breakSec: 60 }, DEFAULT_SETTINGS],
  ['the rule off with 20 and 20 (stays off)', { rule202020: false, workMin: 20, breakSec: 20 }, S({ rule202020: false })],
  ['a string rule flag (worked out from the timings)', { rule202020: 'true', workMin: 30 }, S({ rule202020: false, workMin: 30 })],
  ['breakSec not a choice (45)', { rule202020: false, workMin: 30, breakSec: 45 }, S({ rule202020: false, workMin: 30 })],
  ['breakSec null', { rule202020: false, workMin: 10, breakSec: null }, S({ rule202020: false, workMin: 10 })],
  ['the longest custom timings (kept)', { rule202020: false, workMin: 90, breakSec: 120 }, S({ rule202020: false, workMin: 90, breakSec: 120 })],
  // Snooze
  ['snoozeMin not a choice (7)', { snoozeMin: 7 }, DEFAULT_SETTINGS],
  ['snoozeMin as a string', { snoozeMin: '10' }, DEFAULT_SETTINGS],
  ['snoozeMin 15 (kept)', { snoozeMin: 15 }, S({ snoozeMin: 15 })],
  // Sounds and voices
  ['an unknown start sound', { startSound: 'trumpet' }, DEFAULT_SETTINGS],
  ['an end sound in the wrong case', { endSound: 'Chime' }, DEFAULT_SETTINGS],
  ['the phone and none sounds (kept)', { startSound: 'phone', endSound: 'none' }, S({ startSound: 'phone', endSound: 'none' })],
  ['an unknown voice', { voice: 'robot' }, DEFAULT_SETTINGS],
  ['a known voice (kept)', { voice: 'george', startSound: 'voice' }, S({ voice: 'george', startSound: 'voice' })],
  // Switches
  ['vibration switches of the wrong type', { startVibrate: 'false', endVibrate: 0 }, DEFAULT_SETTINGS],
  ['haptics and tray timer of the wrong type', { haptics: null, trayTimer: 'off' }, DEFAULT_SETTINGS],
  [
    'switches turned off (kept)',
    { startVibrate: false, endVibrate: false, haptics: false, trayTimer: false },
    S({ startVibrate: false, endVibrate: false, haptics: false, trayTimer: false }),
  ],
  // Quiet hours
  ['quiet hours null', { quiet: null }, DEFAULT_SETTINGS],
  ['quiet hours as a string', { quiet: '22:00-08:00' }, DEFAULT_SETTINGS],
  ['quiet hours as an array', { quiet: [1320, 480] }, DEFAULT_SETTINGS],
  ['quiet hours turned off with no times (default times)', { quiet: { enabled: false } }, Q({ enabled: false })],
  ['a quiet switch of the wrong type', { quiet: { enabled: 'no', startMin: 1380, endMin: 420 } }, Q({ startMin: 1380, endMin: 420 })],
  ['a quiet start of 1440 (past the end of the day)', { quiet: { startMin: 1440, endMin: 420 } }, Q({ endMin: 420 })],
  ['a negative quiet start', { quiet: { startMin: -1, endMin: 30 } }, Q({ endMin: 30 })],
  ['a fractional quiet start', { quiet: { startMin: 600.5, endMin: 700 } }, Q({ endMin: 700 })],
  ['quiet times as strings', { quiet: { startMin: '600', endMin: '700' } }, DEFAULT_SETTINGS],
  ['quiet times NaN and Infinity', { quiet: { startMin: NaN, endMin: Infinity } }, DEFAULT_SETTINGS],
  ['equal quiet start and end (both reset)', { quiet: { enabled: false, startMin: 600, endMin: 600 } }, Q({ enabled: false })],
  ['a quiet start equal to the default end (both reset)', { quiet: { startMin: 480 } }, DEFAULT_SETTINGS],
  ['the first and last minute of the day (kept)', { quiet: { startMin: 0, endMin: 1439 } }, Q({ startMin: 0, endMin: 1439 })],
  // Old versions
  ['v0.1 sound on', { sound: true, haptics: true }, DEFAULT_SETTINGS],
  ['v0.1 sound off, vibration on', { sound: false, haptics: true }, S({ startSound: 'none', endSound: 'none' })],
  [
    'v0.1 sound and vibration off',
    { sound: false, haptics: false },
    S({ startSound: 'none', startVibrate: false, endSound: 'none', endVibrate: false, haptics: false }),
  ],
  [
    'v0.2 alert styles',
    { startAlert: 'vibrate', endAlert: 'silent' },
    S({ startSound: 'none', startVibrate: true, endSound: 'none', endVibrate: false }),
  ],
  ['a v0.2 start style next to a v0.1 switch (v0.2 wins)', { sound: true, startAlert: 'silent' }, S({ startSound: 'none', startVibrate: false })],
  [
    'new per-moment keys next to old ones (new keys win)',
    { sound: false, haptics: false, startAlert: 'silent', startSound: 'bell', startVibrate: true },
    S({ startSound: 'bell', startVibrate: true, endSound: 'none', endVibrate: false, haptics: false }),
  ],
  // An unknown old alert style (damaged file) must not silence the reminder: fromAlert() keeps the
  // default sounds rather than mapping it to 'none'.
  ['unknown v0.2 alert styles (default sounds kept)', { startAlert: 'loud', endAlert: 1 }, DEFAULT_SETTINGS],
  ['unknown and old keys (dropped)', { extra: 1, theme: 'dark', sound: true, startAlert: 'quack', endAlert: 'quack' }, DEFAULT_SETTINGS],
];

function assertValidSettings(s: Settings, label: string) {
  assert.deepEqual(Object.keys(s).sort(), Object.keys(DEFAULT_SETTINGS).sort(), label);
  assert.ok(WORK_CHOICES.includes(s.workMin), `${label}: workMin ${s.workMin}`);
  assert.ok(BREAK_CHOICES.includes(s.breakSec), `${label}: breakSec ${s.breakSec}`);
  assert.ok(SNOOZE_CHOICES.includes(s.snoozeMin), `${label}: snoozeMin ${s.snoozeMin}`);
  if (s.rule202020 === true) assert.deepEqual([s.workMin, s.breakSec], [RULE_WORK_MIN, RULE_BREAK_SEC], label);
  assert.ok(SOUND_IDS.includes(s.startSound), `${label}: startSound ${s.startSound}`);
  assert.ok(SOUND_IDS.includes(s.endSound), `${label}: endSound ${s.endSound}`);
  assert.ok(VOICE_IDS.includes(s.voice), `${label}: voice ${s.voice}`);
  for (const b of [s.rule202020, s.startVibrate, s.endVibrate, s.haptics, s.trayTimer, s.quiet.enabled]) {
    assert.equal(typeof b, 'boolean', label);
  }
  assert.deepEqual(Object.keys(s.quiet).sort(), ['enabled', 'endMin', 'startMin'], label);
  for (const m of [s.quiet.startMin, s.quiet.endMin]) assert.ok(Number.isInteger(m) && m >= 0 && m < 1440, `${label}: ${m}`);
  assert.notEqual(s.quiet.startMin, s.quiet.endMin, label);
}

describe('settingsFrom', () => {
  for (const [what, saved, expected] of SETTINGS_ROWS) {
    it(`cleans ${what}`, () => {
      assert.deepEqual(settingsFrom(saved), expected);
    });
  }

  it('is idempotent: cleaning clean settings changes nothing', () => {
    for (const [what, saved] of SETTINGS_ROWS) {
      const once = settingsFrom(saved);
      assert.deepEqual(settingsFrom(once), once, what);
    }
  });

  it('never returns an invalid value for 300 random damaged files (seeded)', () => {
    const rand = mulberry32(2020);
    const junk: unknown[] = [
      undefined, null, NaN, Infinity, -1, 0, 1, 5, 7, 10, 15, 20, 30, 45, 120, 480, 1320, 1439, 1440, 20.5,
      '20', '', 'quack', 'voice', 'phone', 'george', 'trumpet', 'silent', 'vibrate', true, false, {}, [],
    ];
    const keys = [...Object.keys(DEFAULT_SETTINGS), 'sound', 'startAlert', 'endAlert', 'extra'];
    for (let i = 0; i < 300; i++) {
      const saved: Record<string, unknown> = {};
      for (const k of keys) {
        if (rand() < 0.5) continue;
        saved[k] =
          k === 'quiet' && rand() < 0.7
            ? { enabled: pickOne(rand, junk), startMin: pickOne(rand, junk), endMin: pickOne(rand, junk) }
            : pickOne(rand, junk);
      }
      assertValidSettings(settingsFrom(saved), `case ${i}`);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('timerFrom', () => {
  const now = at(10);
  // The limits come from the longest choices (a break or snooze keeps the length it started
  // with), plus 5 s of grace: a break ends at most 2 min ahead; the anchor at most 10 min ahead
  // (a 15-minute snooze with reminders every 5 minutes).
  const limit = now + 120 * SEC + 5 * SEC;
  const anchorLimit = now + 10 * MINUTE + 5 * SEC;
  const fresh: TimerState = { anchor: now, setAt: now, breakEndsAt: null };
  const ok: TimerState = { anchor: at(9, 40), setAt: at(9, 39), breakEndsAt: null };

  it('keeps a valid saved timer as it is', () => {
    const t = { anchor: at(9, 40), setAt: at(9, 39), breakEndsAt: at(9, 59) };
    assert.deepEqual(timerFrom(t, now), t);
  });

  it('starts fresh at now when the saved timer is missing or not an object', () => {
    for (const junk of [undefined, null, 'junk', 42, true, []]) assert.deepEqual(timerFrom(junk, now), fresh, String(junk));
  });

  it('keeps a running break that ends exactly one break length from now', () => {
    const t = { anchor: now + 20 * SEC, setAt: now, breakEndsAt: now + 20 * SEC };
    assert.deepEqual(timerFrom(t, now), t);
  });

  it('keeps a break end exactly at the limit (the longest break plus 5 s)', () => {
    assert.equal(timerFrom({ ...ok, breakEndsAt: limit }, now).breakEndsAt, limit);
  });

  it('drops a break end 1 ms past the limit, as left by a clock that went back', () => {
    assert.deepEqual(timerFrom({ ...ok, breakEndsAt: limit + 1 }, now), ok);
  });

  it('keeps a 2-minute break running after the break length is shortened to 20 s', () => {
    const running = startBreak(ready(custom({ workMin: 30, breakSec: 120 })), now);
    const shorter = updateSettings(running, { breakSec: 20 }, now + SEC);
    assert.deepEqual(timerFrom(JSON.parse(JSON.stringify(shorter.timer)), now + 2 * SEC), running.timer);
  });

  it('keeps a break that ended in the past, so it still gets counted', () => {
    const timer = timerFrom({ anchor: at(9, 50), setAt: at(9, 49), breakEndsAt: at(9, 50) }, now);
    assert.equal(timer.breakEndsAt, at(9, 50));
    assert.equal(breaksOn(finishBreakIfDone({ ...ready(), timer }, now), now), 1);
  });

  it('drops break end times that are not positive, finite numbers', () => {
    for (const bad of [0, -5, NaN, Infinity, String(now), true, {}]) {
      assert.equal(timerFrom({ ...ok, breakEndsAt: bad }, now).breakEndsAt, null, String(bad));
    }
  });

  it('keeps an anchor exactly at the limit', () => {
    assert.deepEqual(timerFrom({ ...ok, anchor: anchorLimit }, now), { ...ok, anchor: anchorLimit });
  });

  it('resets an anchor 1 ms past the limit to now, along with setAt', () => {
    assert.deepEqual(timerFrom({ ...ok, anchor: anchorLimit + 1 }, now), fresh);
  });

  it('resets everything left a day ahead by a clock set back a day, but stays stopped', () => {
    const ahead = now + 24 * HOUR;
    const t = timerFrom({ anchor: ahead, setAt: ahead, breakEndsAt: ahead, paused: true, snoozed: true }, now);
    assert.deepEqual(t, { ...fresh, paused: true });
  });

  it('keeps an anchor from days ago', () => {
    const old = { anchor: at(9, 0, 19), setAt: at(9, 0, 19), breakEndsAt: null };
    assert.deepEqual(timerFrom(old, now), old);
  });

  it('resets anchors that are not positive, finite numbers', () => {
    for (const bad of [0, -1, NaN, -Infinity, '1']) assert.deepEqual(timerFrom({ ...ok, anchor: bad }, now), fresh, String(bad));
  });

  it('clamps a setAt in the future to now, and replaces an invalid one with now', () => {
    assert.deepEqual(timerFrom({ ...ok, setAt: now + HOUR }, now), { ...ok, setAt: now });
    for (const bad of [undefined, NaN, 'x', -1]) assert.equal(timerFrom({ ...ok, setAt: bad }, now).setAt, now, String(bad));
  });

  it('keeps paused only when it is exactly true', () => {
    assert.equal(timerFrom({ ...ok, paused: true }, now).paused, true);
    for (const v of ['true', 1, false, null, {}]) assert.equal(timerFrom({ ...ok, paused: v }, now).paused, undefined, String(v));
  });

  it('keeps snoozed only when it is exactly true', () => {
    assert.equal(timerFrom({ ...ok, snoozed: true }, now).snoozed, true);
    for (const v of ['true', 1, false, null, {}]) assert.equal(timerFrom({ ...ok, snoozed: v }, now).snoozed, undefined, String(v));
  });

  it('drops a snooze whose anchor was reset', () => {
    assert.deepEqual(timerFrom({ ...ok, anchor: now + HOUR, snoozed: true }, now), fresh);
  });

  it('drops unknown keys', () => {
    assert.deepEqual(timerFrom({ ...ok, extra: 1, v: 2 }, now), ok);
  });
});

describe('a timer saved right after a transition loads back unchanged', () => {
  const T = at(10);
  const reload = (d: AppData, now: number) => timerFrom(JSON.parse(JSON.stringify(d.timer)), now);

  it('after starting a 2-minute break', () => {
    const d = startBreak(ready(custom({ workMin: 30, breakSec: 120 })), T);
    assert.deepEqual(reload(d, T), d.timer);
    assert.deepEqual(reload(d, T + SEC), d.timer);
  });

  it('after snoozing for less than the reminder interval', () => {
    const d = snooze(ready(), T);
    assert.deepEqual(reload(d, T + SEC), d.timer);
  });

  // snooze() sets anchor = now + (snoozeMin - workMin) min. When snoozeMin is longer than workMin
  // (both choosable in Settings, e.g. every 5 min, snooze 10), that anchor is minutes ahead.
  // timerFrom must not take it for a clock that went back: the timer and `snoozed` survive the
  // reload, and the reminder still comes snoozeMin after the snooze.
  it('after snoozing for longer than the reminder interval', () => {
    const combos: [number, number][] = [
      [5, 10],
      [5, 15],
      [10, 15],
    ];
    for (const [workMin, snoozeMin] of combos) {
      const d = snooze(ready(custom({ workMin, snoozeMin })), T);
      const loaded = reload(d, T + SEC);
      assert.deepEqual(loaded, d.timer, `every ${workMin} min, snooze ${snoozeMin} min`);
      assert.equal(planBreaks(T + SEC, d.settings, loaded).dueAt, T + snoozeMin * MINUTE);
    }
  });

  it('after changing the interval during a break', () => {
    const d = updateSettings(startBreak(ready(custom({ workMin: 30 })), T), { workMin: 45 }, T + 5 * SEC);
    assert.deepEqual(reload(d, T + 6 * SEC), d.timer);
  });

  it('after stopping reminders', () => {
    const d = stopReminders(ready(), T);
    assert.deepEqual(reload(d, T + HOUR), d.timer);
  });
});

// ---------------------------------------------------------------------------------------------

describe('pond counting over a simulated day', () => {
  it('counts every break of a workday at 20-minute intervals', () => {
    let d = ready();
    for (let k = 0; k < 24; k++) d = startBreak(d, at(9) + k * 20 * MINUTE); // 9:00 to 16:40
    d = finishBreakIfDone(d, at(17));
    assert.deepEqual(d.days, { '2026-10-22': 24 });
    assert.deepEqual(d.pond, { ...defaultPond(), total: 24, lastAt: at(16, 40, 22, 20) });
  });

  it('counts "take a break now" spam as breaks today, but grows the duck at most every 5 minutes', () => {
    let d = ready();
    for (let k = 0; k < 20; k++) d = startBreak(d, at(10) + k * 30 * SEC); // ends 10:00:20, 10:00:50, ...
    d = finishBreakIfDone(d, at(10, 15));
    assert.deepEqual(d.days, { '2026-10-22': 20 });
    assert.equal(d.pond.total, 2); // 10:00:20, and exactly 5 minutes later at 10:05:20
    assert.equal(d.pond.lastAt, at(10, 5, 22, 20));
  });

  it('measures the 5 minutes from the last counted break, not the last break', () => {
    let d = ready();
    for (let k = 0; k < 6; k++) d = startBreak(d, at(10) + k * 4 * MINUTE); // ends 4 minutes apart
    d = finishBreakIfDone(d, at(10, 30));
    assert.equal(breaksOn(d, at(10)), 6);
    assert.equal(d.pond.total, 3); // 10:00:20, 10:08:20, 10:16:20
  });

  it('counts breaks around midnight on the day each one ended', () => {
    let d = startBreak(ready(), at(23, 59, 22, 30)); // ends 23:59:50 on the 22nd
    d = startBreak(d, at(23, 59, 22, 55)); // ends 00:00:15 on the 23rd
    d = finishBreakIfDone(d, at(0, 10, 23));
    assert.deepEqual(d.days, { '2026-10-22': 1, '2026-10-23': 1 });
    assert.equal(d.pond.total, 1); // 25 s apart: only the first grows the duck
  });

  it('adds up a whole day: regular breaks, spam, a break at exactly 5 minutes, and one across midnight', () => {
    let d = ready(noQuiet, at(8));
    for (let k = 0; k < 9; k++) d = startBreak(d, at(9) + k * 20 * MINUTE); // 9:00 to 11:40
    for (let k = 0; k < 10; k++) d = startBreak(d, at(12, 10) + k * 30 * SEC); // end 12:10:20 to 12:14:50
    d = startBreak(d, at(12, 15)); // ends 12:15:20, exactly 5 minutes after 12:10:20
    d = startBreak(d, at(23, 59, 22, 50)); // ends 00:00:10 on the 23rd
    d = finishBreakIfDone(d, at(0, 5, 23));
    assert.deepEqual(d.days, { '2026-10-22': 20, '2026-10-23': 1 });
    assert.equal(d.pond.total, 12);
    assert.equal(d.pond.lastAt, at(0, 0, 23, 10));
    const sum = Object.values(d.days).reduce((a, b) => a + b, 0);
    assert.ok(d.pond.total <= sum);
  });
});

// ---------------------------------------------------------------------------------------------

/** Everything that must hold for any plan. */
function checkPlan(d: AppData, now: number, max: number, label: string) {
  const plan = planNotifications(d, now, max);
  const msg = (what: string) => `${label}: ${what}`;
  assert.deepEqual(planNotifications(d, now, max), plan, msg('not deterministic'));
  assert.equal(new Set(plan.map((n) => n.id)).size, plan.length, msg('duplicate ids'));
  for (const n of plan) assert.ok(n.at > now, msg(`${n.kind} at ${n.at} is not after now (${now})`));

  const due = ofKind(plan, 'due');
  const over = ofKind(plan, 'over');
  const out = ofKind(plan, 'out');
  assert.equal(due.length + over.length + out.length, plan.length, msg('unknown kind'));
  assert.ok(over.length <= 1, msg('more than one over'));
  assert.ok(out.length <= 1, msg('more than one out'));
  assert.ok(due.length <= max, msg(`${due.length} reminders for max ${max}`));
  for (let i = 1; i < due.length; i++) assert.ok(due[i]!.at > due[i - 1]!.at, msg('reminders not sorted'));

  const running = d.timer.breakEndsAt !== null && d.timer.breakEndsAt > now;
  assert.equal(over.length, running ? 1 : 0, msg('break-over'));
  if (running) assert.equal(over[0]!.at, d.timer.breakEndsAt);
  if (d.timer.paused) assert.equal(due.length + out.length, 0, msg('booked while stopped'));
  assert.equal(out.length, due.length > 0 ? 1 : 0, msg('last call'));
  if (out.length) {
    assert.ok(out[0]!.at > due[due.length - 1]!.at, msg('last call before the last reminder'));
    assert.equal(isQuiet(out[0]!.at, d.settings.quiet), false, msg('last call in quiet hours'));
  }

  const fp = contentFingerprint(d.settings);
  for (const n of plan) assert.ok(n.id.endsWith(`_${fp}`), msg(`id ${n.id} without the fingerprint`));
  const dueAt = planBreaks(now, d.settings, d.timer, { max }).dueAt;
  for (const n of due) {
    if (isQuiet(n.at, d.settings.quiet)) assert.ok(d.timer.snoozed && n.at === dueAt, msg('reminder in quiet hours'));
  }
}

function randomSettings(rand: () => number): Settings {
  return settingsFrom({
    rule202020: rand() < 0.4,
    workMin: pickOne(rand, WORK_CHOICES),
    breakSec: pickOne(rand, BREAK_CHOICES),
    snoozeMin: pickOne(rand, SNOOZE_CHOICES),
    quiet: { enabled: rand() < 0.7, startMin: randInt(rand, 0, 95) * 15, endMin: randInt(rand, 0, 95) * 15 },
    startSound: pickOne(rand, SOUND_IDS),
    startVibrate: rand() < 0.5,
    endSound: pickOne(rand, SOUND_IDS),
    endVibrate: rand() < 0.5,
    voice: pickOne(rand, VOICE_IDS),
  });
}

describe('planNotifications', () => {
  it('plans nothing before onboarding, even with a break running', () => {
    const d = startBreak(defaultData(at(9)), at(10));
    assert.deepEqual(planNotifications(d, at(10) + SEC), []);
  });

  it('books reminders every workMin from the anchor, starting after now', () => {
    const plan = planNotifications(ready(), at(10), 3);
    assert.deepEqual(
      ofKind(plan, 'due').map((n) => n.at),
      [at(10, 20), at(10, 40), at(11)],
    );
  });

  it('does not book a reminder that is due exactly now', () => {
    assert.equal(ofKind(planNotifications(ready(), at(9, 20)), 'due')[0]!.at, at(9, 40));
  });

  it('books everything after now, even when the anchor is days old', () => {
    const d = { ...ready(), timer: { anchor: at(9, 0, 19), setAt: at(9, 0, 19), breakEndsAt: null } };
    const plan = planNotifications(d, at(10, 7));
    assert.ok(plan.every((n) => n.at > at(10, 7)));
    assert.equal(ofKind(plan, 'due')[0]!.at, at(10, 20));
  });

  it('gives every notification a unique id', () => {
    const plan = planNotifications(startBreak(ready(custom({ workMin: 5 })), at(10)), at(10), MAX_REMINDERS_ANDROID);
    assert.equal(new Set(plan.map((n) => n.id)).size, plan.length);
  });

  it('is stable: the same input gives the same plan', () => {
    const d = startBreak(ready(DEFAULT_SETTINGS), at(10));
    assert.deepEqual(planNotifications(d, at(10) + SEC), planNotifications(d, at(10) + SEC));
  });

  it('keeps the same ids a minute later, before the first reminder', () => {
    const d = ready();
    assert.deepEqual(
      planNotifications(d, at(10, 1)).map((n) => n.id),
      planNotifications(d, at(10)).map((n) => n.id),
    );
  });

  const CHANGES: [string, Partial<Settings>][] = [
    ['the reminder sound', { startSound: 'chime' }],
    ['the reminder vibration', { startVibrate: false }],
    ['the break-over sound', { endSound: 'voice' }],
    ['the break-over vibration', { endVibrate: false }],
    ['the voice', { voice: 'michael' }],
    ['the break length', { breakSec: 30 }],
    ['the snooze length', { snoozeMin: 10 }],
  ];
  for (const [what, patch] of CHANGES) {
    it(`changes every id, but no time, when ${what} changes`, () => {
      const base = startBreak(ready(custom({ workMin: 20 })), at(10));
      const now = at(10) + 5 * SEC;
      const before = planNotifications(base, now);
      const after = planNotifications({ ...base, settings: { ...base.settings, ...patch } }, now);
      assert.deepEqual(
        after.map((n) => [n.kind, n.at]),
        before.map((n) => [n.kind, n.at]),
      );
      assert.deepEqual(
        [...new Set(after.map((n) => n.kind))].sort(),
        ['due', 'out', 'over'],
      );
      const old = new Set(before.map((n) => n.id));
      for (const n of after) assert.equal(old.has(n.id), false, n.id);
    });
  }

  it('keeps the ids when only button haptics change', () => {
    const d = ready();
    const quiet = { ...d, settings: { ...d.settings, haptics: false } };
    assert.deepEqual(
      planNotifications(quiet, at(10)).map((n) => n.id),
      planNotifications(d, at(10)).map((n) => n.id),
    );
  });

  it('books a break-over notification at the end of a running break', () => {
    const d = startBreak(ready(), at(10));
    const over = ofKind(planNotifications(d, at(10) + SEC), 'over');
    assert.equal(over.length, 1);
    assert.equal(over[0]!.at, at(10) + 20 * SEC);
    assert.equal(over[0]!.id, `over_${at(10) + 20 * SEC}_${contentFingerprint(d.settings)}`);
  });

  it('books no break-over once the break has ended', () => {
    const d = startBreak(ready(), at(10));
    assert.deepEqual(ofKind(planNotifications(d, at(10) + 20 * SEC), 'over'), []);
  });

  it('books a last call one interval after the final reminder', () => {
    const plan = planNotifications(ready(), at(9), 3);
    assert.deepEqual(
      ofKind(plan, 'due').map((n) => n.at),
      [at(9, 20), at(9, 40), at(10)],
    );
    assert.deepEqual(
      ofKind(plan, 'out').map((n) => [n.at, n.title, n.body]),
      [[at(10, 20), OUT_TITLE, OUT_BODY]],
    );
  });

  it('moves the last call out of quiet hours, to when they end', () => {
    const plan = planNotifications(ready(DEFAULT_SETTINGS), at(9), 38); // 9:20 to 21:40
    assert.equal(ofKind(plan, 'due').at(-1)!.at, at(21, 40));
    assert.deepEqual(
      ofKind(plan, 'out').map((n) => n.at),
      [at(8, 0, 23)], // 22:00 is quiet
    );
  });

  it('books nothing while reminders are stopped', () => {
    assert.deepEqual(planNotifications(stopReminders(ready(DEFAULT_SETTINGS), at(10)), at(10)), []);
  });

  it('books only the break-over for a break taken while reminders are stopped', () => {
    const d = startBreak(stopReminders(ready(), at(10)), at(11));
    const plan = planNotifications(d, at(11) + SEC);
    assert.deepEqual(
      plan.map((n) => [n.kind, n.at]),
      [['over', at(11) + 20 * SEC]],
    );
  });

  it('books exactly max reminders: 60 by default and 150 on Android', () => {
    const d = ready(DEFAULT_SETTINGS);
    assert.equal(MAX_REMINDERS, 60);
    assert.equal(MAX_REMINDERS_ANDROID, 150);
    assert.equal(ofKind(planNotifications(d, at(10)), 'due').length, 60);
    assert.equal(ofKind(planNotifications(d, at(10), MAX_REMINDERS_ANDROID), 'due').length, 150);
  });

  it('stays within the iOS limit of 64 pending notifications', () => {
    const plan = planNotifications(startBreak(ready(custom({ workMin: 5 })), at(10)), at(10) + SEC);
    assert.equal(plan.length, MAX_REMINDERS + 2);
    assert.ok(plan.length <= 64);
  });

  it('books a snoozed reminder even when it lands in quiet hours', () => {
    const d = snooze(ready(DEFAULT_SETTINGS), at(21, 58));
    const due = ofKind(planNotifications(d, at(21, 58)), 'due');
    assert.deepEqual(
      due.slice(0, 2).map((n) => n.at),
      [at(22, 3), at(8, 20, 23)],
    );
  });

  it('holds for 30 random states reached through transitions (seeded)', () => {
    for (let i = 0; i < 30; i++) {
      const rand = mulberry32(1000 + i);
      let t = at(randInt(rand, 0, 23), randInt(rand, 0, 59), randInt(rand, 19, 21)) + randInt(rand, 0, 59_999);
      let d: AppData = { ...finishOnboarding(defaultData(t), t), settings: randomSettings(rand) };
      const steps = randInt(rand, 0, 6);
      for (let k = 0; k < steps; k++) {
        t += randInt(rand, 0, 3 * HOUR);
        const r = rand();
        d =
          r < 0.35
            ? startBreak(d, t)
            : r < 0.5
              ? skipBreak(d, t)
              : r < 0.65
                ? snooze(d, t)
                : r < 0.75
                  ? stopReminders(d, t)
                  : r < 0.85
                    ? resumeReminders(d, t)
                    : updateSettings(d, { rule202020: false, workMin: pickOne(rand, WORK_CHOICES) }, t);
      }
      const now = t + (rand() < 0.4 ? randInt(rand, 0, d.settings.breakSec * SEC) : randInt(rand, 0, 30 * HOUR));
      checkPlan(d, now, rand() < 0.5 ? MAX_REMINDERS : MAX_REMINDERS_ANDROID, `walk ${i}`);
    }
  });

  it('holds for 30 random saved timers loaded through timerFrom (seeded)', () => {
    for (let i = 0; i < 30; i++) {
      const rand = mulberry32(5000 + i);
      const settings = randomSettings(rand);
      const now = at(randInt(rand, 0, 23), randInt(rand, 0, 59), randInt(rand, 19, 21)) + randInt(rand, 0, 59_999);
      const breakMs = settings.breakSec * SEC;
      const saved = {
        // Some anchors and break ends sit too far ahead (a clock that went back), some just inside the limit.
        anchor: now + (rand() < 0.3 ? randInt(rand, 0, 2 * HOUR) : -randInt(rand, 0, 3 * 24 * HOUR)),
        setAt: now + randInt(rand, -4 * 24 * HOUR, HOUR),
        breakEndsAt:
          rand() < 0.3 ? null : now + (rand() < 0.6 ? randInt(rand, -breakMs, breakMs + 10 * SEC) : randInt(rand, -HOUR, HOUR)),
        paused: rand() < 0.2,
        snoozed: rand() < 0.3,
      };
      const timer = timerFrom(saved, now);
      const limit = now + settings.breakSec * SEC + 5 * SEC;
      assert.ok(timer.anchor <= limit && timer.setAt <= now, `timer ${i}`);
      assert.ok(timer.breakEndsAt === null || timer.breakEndsAt <= limit, `timer ${i}`);
      checkPlan({ ...ready(settings), timer }, now, rand() < 0.5 ? MAX_REMINDERS : MAX_REMINDERS_ANDROID, `timer ${i}`);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('immutability', () => {
  const NOW = at(10, 20);
  const inputs: [string, AppData][] = [
    ['fresh', ready()],
    ['break running', startBreak(ready(), NOW - 5 * SEC)],
    ['break ended, 400 days of history', { ...breakEndedAt(at(10)), days: pastDays(400) }],
    ['snoozed', snooze(ready(), at(10))],
    ['stopped', stopReminders(ready(), at(10))],
    ['grown duck', { ...pondWith(95, 'bow'), pond: { ...pondWith(95, 'bow').pond, seen: 40 }, handled: ['a', 'b'] }],
  ];
  const transitions: [string, (d: AppData) => AppData][] = [
    ['finishBreakIfDone', (d) => finishBreakIfDone(d, NOW)],
    ['startBreak', (d) => startBreak(d, NOW)],
    ['skipBreak', (d) => skipBreak(d, NOW)],
    ['snooze', (d) => snooze(d, NOW)],
    ['stopReminders', (d) => stopReminders(d, NOW)],
    ['resumeReminders', (d) => resumeReminders(d, NOW)],
    ['finishOnboarding', (d) => finishOnboarding(d, NOW)],
    ['updateSettings (interval)', (d) => updateSettings(d, { rule202020: false, workMin: 45 }, NOW)],
    ['updateSettings (sound)', (d) => updateSettings(d, { endSound: 'drop', quiet: { ...d.settings.quiet, enabled: true } }, NOW)],
    ['rememberHandled', (d) => rememberHandled(d, 'key')],
    ['wearItem', (d) => wearItem(d, 'beanie')],
    ['wearItem (null)', (d) => wearItem(d, null)],
    ['renameDuck', (d) => renameDuck(d, '  Mr  Duck ')],
    ['markPondSeen', (d) => markPondSeen(d)],
  ];

  it('no transition modifies its (deep-frozen) input', () => {
    for (const [state, input] of inputs) {
      for (const [name, run] of transitions) {
        const frozen = frozenCopy(input);
        assert.doesNotThrow(() => run(frozen), `${name} on ${state}`);
        assert.deepEqual(frozen, input, `${name} on ${state}`);
      }
    }
  });

  it('transitions return new objects for the parts they change, so later edits never leak back', () => {
    const input = breakEndedAt(at(10));
    const done = finishBreakIfDone(input, NOW);
    assert.notEqual(done.days, input.days);
    assert.notEqual(done.timer, input.timer);
    assert.notEqual(done.pond, input.pond);
    assert.notEqual(rememberHandled(input, 'k').handled, input.handled);
    assert.notEqual(updateSettings(input, { voice: 'bella' }, NOW).settings, input.settings);
  });

  it('settingsFrom and timerFrom never modify the saved data, and share none of it', () => {
    const saved = frozenCopy({ sound: false, haptics: false, startAlert: 'quack', quiet: { enabled: true, startMin: 60, endMin: 120 } });
    const s = settingsFrom(saved);
    assert.notEqual(s.quiet, saved.quiet);
    assert.notEqual(settingsFrom(undefined).quiet, DEFAULT_SETTINGS.quiet);
    const timer = frozenCopy({ anchor: at(9), setAt: at(10) + HOUR, breakEndsAt: at(10), paused: true, snoozed: 'x' });
    assert.deepEqual(timerFrom(timer, at(10)), { anchor: at(9), setAt: at(10), breakEndsAt: at(10), paused: true });
  });

  it('planNotifications never modifies the data', () => {
    for (const [state, input] of inputs) {
      const frozen = frozenCopy(input);
      assert.doesNotThrow(() => planNotifications(frozen, NOW, MAX_REMINDERS_ANDROID), state);
    }
  });

  it('defaultData gives every call its own timer, history, handled list and pond', () => {
    const a = defaultData(at(9));
    const b = defaultData(at(9));
    assert.deepEqual(a, b);
    assert.notEqual(a.timer, b.timer);
    assert.notEqual(a.days, b.days);
    assert.notEqual(a.handled, b.handled);
    assert.notEqual(a.pond, b.pond);
  });
});
