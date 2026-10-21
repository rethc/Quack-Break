// Run with: npm test   (Node's built-in test runner, no extra packages)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planNotifications, MAX_REMINDERS } from './notificationPlan.ts';
import { dayKey, HOUR, isQuiet, MINUTE, planBreaks } from './schedule.ts';
import { breaksOn, finishBreakIfDone, finishOnboarding, skipBreak, snooze, startBreak } from './transitions.ts';
import { DEFAULT_SETTINGS, defaultData, type Settings, type TimerState } from './types.ts';

const at = (h: number, m = 0, day = 22) => new Date(2026, 9, day, h, m).getTime();
const noQuiet: Settings = { ...DEFAULT_SETTINGS, quiet: { enabled: false, startMin: 0, endMin: 0 } };
const timer = (anchor: number, setAt = anchor): TimerState => ({ anchor, setAt, breakEndsAt: null });
const hm = (t: number) => {
  const d = new Date(t);
  return `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

describe('quiet hours', () => {
  const night = { enabled: true, startMin: 22 * 60, endMin: 8 * 60 };
  const lunch = { enabled: true, startMin: 12 * 60, endMin: 13 * 60 };
  it('wraps past midnight', () => {
    assert.equal(isQuiet(at(23), night), true);
    assert.equal(isQuiet(at(3), night), true);
    assert.equal(isQuiet(at(8), night), false);
    assert.equal(isQuiet(at(21, 59), night), false);
  });
  it('works within one day', () => {
    assert.equal(isQuiet(at(12, 30), lunch), true);
    assert.equal(isQuiet(at(13), lunch), false);
  });
  it('is off when disabled or empty', () => {
    assert.equal(isQuiet(at(23), { ...night, enabled: false }), false);
    assert.equal(isQuiet(at(23), { enabled: true, startMin: 600, endMin: 600 }), false);
  });
});

describe('planBreaks', () => {
  it('reminds every work interval from the anchor', () => {
    const p = planBreaks(at(10), noQuiet, timer(at(10)), { max: 3 });
    assert.deepEqual(p.reminders.map(hm), ['22 10:20', '22 10:40', '22 11:00']);
    assert.equal(p.overdue, false);
  });

  it('marks an ignored break as overdue and keeps the cadence', () => {
    const p = planBreaks(at(10, 25), noQuiet, timer(at(10)), { max: 2 });
    assert.equal(p.overdue, true);
    assert.equal(hm(p.dueAt), '22 10:20');
    assert.deepEqual(p.reminders.map(hm), ['22 10:40', '22 11:00']);
  });

  it('skips quiet hours and restarts the cadence when they end', () => {
    const p = planBreaks(at(21, 50), DEFAULT_SETTINGS, timer(at(21, 45)), { max: 2 });
    assert.deepEqual(p.reminders.map(hm), ['23 08:20', '23 08:40']);
  });

  it('is not overdue right after quiet hours end', () => {
    const p = planBreaks(at(8, 5, 23), DEFAULT_SETTINGS, timer(at(21, 45)), { max: 1 });
    assert.equal(p.quietNow, false);
    assert.equal(p.overdue, false);
    assert.equal(hm(p.dueAt), '23 08:20');
  });

  it('reports quiet time and does not nag', () => {
    const p = planBreaks(at(23), DEFAULT_SETTINGS, timer(at(18)), { max: 1 });
    assert.equal(p.quietNow, true);
    assert.equal(p.overdue, false);
    assert.equal(hm(p.reminders[0]!), '23 08:20');
  });

  it('caps the number of reminders and the horizon', () => {
    const s = { ...noQuiet, workMin: 5 };
    assert.equal(planBreaks(at(10), s, timer(at(10))).reminders.length, 60);
    const p = planBreaks(at(10), s, timer(at(10)), { max: 999, horizonMs: HOUR });
    assert.equal(p.reminders.length, 12);
  });

  it('survives quiet hours covering almost the whole day', () => {
    const s = { ...DEFAULT_SETTINGS, quiet: { enabled: true, startMin: 8 * 60 + 1, endMin: 8 * 60 } };
    const p = planBreaks(at(10), s, timer(at(10)));
    assert.ok(p.reminders.length <= 3);
  });
});

describe('transitions', () => {
  const ready = finishOnboarding(defaultData(at(9)), at(9));

  it('starting a break schedules the next one after it ends', () => {
    const d = startBreak({ ...ready, settings: noQuiet }, at(10));
    assert.equal(d.timer.breakEndsAt, at(10) + 20_000);
    const p = planBreaks(at(10), d.settings, d.timer);
    assert.equal(p.breakActive, true);
    assert.equal(p.overdue, false);
    assert.equal(p.reminders[0], at(10, 20) + 20_000);
  });

  it('does not restart a running break', () => {
    const d = startBreak(ready, at(10));
    assert.equal(startBreak(d, at(10) + 5_000), d);
  });

  it('counts a finished break once, on the day it ended', () => {
    const d = startBreak(ready, at(10));
    assert.equal(finishBreakIfDone(d, at(10) + 5_000), d);
    const done = finishBreakIfDone(d, at(10) + 25_000);
    assert.equal(breaksOn(done, at(12)), 1);
    assert.equal(done.timer.breakEndsAt, null);
    assert.equal(finishBreakIfDone(done, at(11)), done);
  });

  it('skipping records nothing and restarts the cadence', () => {
    const d = skipBreak(startBreak(ready, at(10)), at(10) + 3_000);
    assert.equal(breaksOn(d, at(10)), 0);
    assert.equal(planBreaks(at(10, 1), noQuiet, d.timer).reminders[0], at(10, 20) + 3_000);
  });

  it('snooze reminds after snoozeMin, even right after quiet hours', () => {
    const d = snooze(ready, at(8, 3, 23));
    const p = planBreaks(at(8, 3, 23), d.settings, d.timer, { max: 2 });
    assert.equal(p.overdue, false);
    assert.deepEqual(p.reminders.map(hm), ['23 08:08', '23 08:28']);
  });

  it('dayKey uses local dates', () => {
    assert.equal(dayKey(at(0, 5)), '2026-10-22');
  });
});

describe('planNotifications', () => {
  it('stays under the iOS limit and includes the break-over quack', () => {
    const d = startBreak({ ...finishOnboarding(defaultData(at(9)), at(9)), settings: { ...noQuiet, workMin: 5 } }, at(10));
    const plan = planNotifications(d, at(10));
    assert.equal(plan.filter((n) => n.kind === 'over').length, 1);
    assert.equal(plan.filter((n) => n.kind === 'due').length, MAX_REMINDERS);
    assert.ok(plan.length <= 64);
    assert.equal(new Set(plan.map((n) => n.id)).size, plan.length);
  });

  it('is stable for the same input and changes ids when settings change', () => {
    const d = finishOnboarding(defaultData(at(9)), at(9));
    const a = planNotifications(d, at(10)).map((n) => n.id);
    assert.deepEqual(planNotifications(d, at(10, 1)).map((n) => n.id), a);
    const louder = { ...d, settings: { ...d.settings, sound: false } };
    assert.notEqual(planNotifications(louder, at(10))[0]!.id, a[0]);
  });

  it('plans nothing before onboarding', () => {
    assert.deepEqual(planNotifications(defaultData(at(9)), at(10)), []);
  });

  it('mentions the break length', () => {
    const d = finishOnboarding(defaultData(at(9)), at(9));
    const s30 = { ...d, settings: { ...d.settings, breakSec: 30 } };
    assert.match(planNotifications(s30, at(10))[0]!.body, /30/);
  });
});

void MINUTE;
