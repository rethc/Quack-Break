// Run with: npm test   (Node's built-in test runner, no extra packages)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_REMINDERS, MAX_REMINDERS_ANDROID, OUT_TITLE, planNotifications } from './notificationPlan.ts';
import { dayKey, HOUR, isQuiet, planBreaks } from './schedule.ts';
import {
  breaksOn,
  finishBreakIfDone,
  finishOnboarding,
  resumeReminders,
  skipBreak,
  snooze,
  startBreak,
  stopReminders,
  updateSettings,
} from './transitions.ts';
import { soundFile } from './sounds.ts';
import { DEFAULT_SETTINGS, defaultData, settingsFrom, timerFrom, type Settings, type TimerState } from './types.ts';

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
    const louder = { ...d, settings: { ...d.settings, startSound: 'chime' as const } };
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

describe('settingsFrom', () => {
  it('uses the defaults for a fresh install', () => {
    assert.deepEqual(settingsFrom(undefined), DEFAULT_SETTINGS);
  });

  it('turns the v0.1 sound and vibration switches into per-moment sounds', () => {
    const quack = settingsFrom({ sound: true, haptics: true });
    assert.equal(quack.startSound, 'quack');
    assert.equal(quack.endVibrate, true);
    const buzz = settingsFrom({ sound: false, haptics: true });
    assert.equal(buzz.endSound, 'none');
    assert.equal(buzz.endVibrate, true);
    const silent = settingsFrom({ sound: false, haptics: false });
    assert.equal(silent.startSound, 'none');
    assert.equal(silent.startVibrate, false);
    assert.equal('sound' in quack, false);
  });

  it('turns the v0.2 alert styles into sounds and vibration', () => {
    const s = settingsFrom({ startAlert: 'vibrate', endAlert: 'silent' });
    assert.deepEqual([s.startSound, s.startVibrate, s.endSound, s.endVibrate], ['none', true, 'none', false]);
    assert.equal('startAlert' in s, false);
  });

  it('keeps custom timings with the 20-20-20 rule off', () => {
    assert.equal(settingsFrom({ workMin: 20, breakSec: 20 }).rule202020, true);
    const custom = settingsFrom({ workMin: 30, breakSec: 20 });
    assert.equal(custom.rule202020, false);
    assert.equal(custom.workMin, 30);
  });
});

describe('stopping reminders', () => {
  it('plans no reminders while stopped, and resumes from the moment of resuming', () => {
    const d = finishOnboarding(defaultData(at(9)), at(9));
    const stopped = stopReminders({ ...d, settings: noQuiet }, at(10));
    const p = planBreaks(at(11), stopped.settings, stopped.timer, { max: 3 });
    assert.equal(p.reminders.length, 0);
    assert.equal(p.overdue, false);
    const resumed = resumeReminders(stopped, at(12));
    assert.equal(planBreaks(at(12), resumed.settings, resumed.timer, { max: 1 }).reminders[0], at(12, 20));
  });

  it('turns the tray timer on by default', () => {
    assert.equal(settingsFrom({}).trayTimer, true);
  });
});

describe('soundFile', () => {
  it('picks the file for each moment', () => {
    const s = { ...DEFAULT_SETTINGS, startSound: 'chime' as const, endSound: 'none' as const };
    assert.equal(soundFile('start', s), 'chime.wav');
    assert.equal(soundFile('end', s), null);
  });

  it('has the voice say rest at the start and work at the end', () => {
    const s = { ...DEFAULT_SETTINGS, startSound: 'voice' as const, endSound: 'voice' as const, voice: 'george' as const };
    assert.equal(soundFile('start', s), 'voice_george_rest.wav');
    assert.equal(soundFile('end', s), 'voice_george_work.wav');
  });

  it('uses the phone default sound for "phone"', () => {
    assert.equal(soundFile('start', { ...DEFAULT_SETTINGS, startSound: 'phone' }), 'default');
  });
});

describe('breaks taken from the notification', () => {
  const ready = { ...finishOnboarding(defaultData(at(9)), at(9)), settings: noQuiet };

  it('counts a finished break when the next one starts, without the app opening in between', () => {
    const first = startBreak(ready, at(10));
    const second = startBreak(first, at(10, 20));
    assert.equal(breaksOn(second, at(10)), 1);
    const third = startBreak(second, at(10, 40));
    assert.equal(breaksOn(third, at(10)), 2);
  });

  it('counts a finished break before a snooze, skip, stop or resume', () => {
    const done = startBreak(ready, at(10));
    for (const next of [snooze, skipBreak, stopReminders, resumeReminders]) {
      assert.equal(breaksOn(next(done, at(10, 20)), at(10)), 1, next.name);
    }
  });

  it('does not count a break that was ended early', () => {
    assert.equal(breaksOn(skipBreak(startBreak(ready, at(10)), at(10) + 5_000), at(10)), 0);
  });
});

describe('edge cases', () => {
  const night = { enabled: true, startMin: 22 * 60, endMin: 8 * 60 };
  const ready = { ...finishOnboarding(defaultData(at(9)), at(9)), settings: { ...DEFAULT_SETTINGS, quiet: night } };

  it('lets a snooze ring even when it lands in quiet hours', () => {
    const d = snooze(ready, at(21, 58));
    const p = planBreaks(at(21, 58), d.settings, d.timer, { max: 2 });
    assert.deepEqual(p.reminders.map(hm), ['22 22:03', '23 08:20']);
    assert.equal(planBreaks(at(22, 4), d.settings, d.timer).overdue, true);
  });

  it('keeps reminders stopped through a break taken by hand', () => {
    const stopped = stopReminders(ready, at(10));
    const d = startBreak(stopped, at(11));
    assert.equal(d.timer.paused, true);
    assert.deepEqual(planBreaks(at(11), d.settings, d.timer).reminders, []);
    assert.equal(planNotifications(d, at(11)).filter((n) => n.kind === 'over').length, 1);
  });

  it('counts a new reminder interval from now', () => {
    const d = updateSettings({ ...ready, settings: { ...ready.settings, rule202020: false, workMin: 60 } }, { workMin: 10 }, at(10));
    const p = planBreaks(at(10), d.settings, d.timer, { max: 1 });
    assert.equal(p.overdue, false);
    assert.equal(p.reminders[0], at(10, 10));
    const same = updateSettings(d, { haptics: false }, at(10, 5));
    assert.equal(same.timer, d.timer);
  });
});

describe('damaged or old saved data', () => {
  it('replaces invalid settings with defaults', () => {
    const s = settingsFrom({
      rule202020: false,
      workMin: 0,
      breakSec: 'x',
      snoozeMin: -1,
      startSound: 'trumpet',
      voice: 'robot',
      quiet: { enabled: true, startMin: 600, endMin: 600 },
      extra: 1,
    });
    assert.equal(s.workMin, DEFAULT_SETTINGS.workMin);
    assert.equal(s.breakSec, DEFAULT_SETTINGS.breakSec);
    assert.equal(s.snoozeMin, DEFAULT_SETTINGS.snoozeMin);
    assert.equal(s.startSound, DEFAULT_SETTINGS.startSound);
    assert.equal(s.voice, DEFAULT_SETTINGS.voice);
    assert.notEqual(s.quiet.startMin, s.quiet.endMin);
    assert.equal('extra' in s, false);
    assert.deepEqual(settingsFrom(null), DEFAULT_SETTINGS);
  });

  it('resets times left in the future by a clock that went back', () => {
    const now = at(10);
    const t = timerFrom({ anchor: now + 24 * HOUR, setAt: now + 24 * HOUR, breakEndsAt: now + 24 * HOUR }, DEFAULT_SETTINGS, now);
    assert.deepEqual(t, { anchor: now, setAt: now, breakEndsAt: null });
    const running = timerFrom({ anchor: now + 10_000, setAt: now - 10_000, breakEndsAt: now + 10_000 }, DEFAULT_SETTINGS, now);
    assert.equal(running.breakEndsAt, now + 10_000);
    assert.deepEqual(timerFrom('junk', DEFAULT_SETTINGS, now), { anchor: now, setAt: now, breakEndsAt: null });
  });
});

describe('running out of booked reminders', () => {
  const night = { enabled: true, startMin: 22 * 60, endMin: 8 * 60 };

  it('books a last call after the final reminder, outside quiet hours', () => {
    const d = { ...finishOnboarding(defaultData(at(9)), at(9)), settings: { ...DEFAULT_SETTINGS, quiet: night } };
    const plan = planNotifications(d, at(9));
    const due = plan.filter((n) => n.kind === 'due');
    const out = plan.filter((n) => n.kind === 'out');
    assert.equal(out.length, 1);
    assert.equal(out[0]!.title, OUT_TITLE);
    assert.ok(out[0]!.at > due[due.length - 1]!.at);
    assert.equal(isQuiet(out[0]!.at, night), false);
  });

  it('books further ahead on Android', () => {
    const d = { ...finishOnboarding(defaultData(at(9)), at(9)), settings: { ...noQuiet, rule202020: false, workMin: 5 } };
    const plan = planNotifications(d, at(9), MAX_REMINDERS_ANDROID);
    assert.equal(plan.filter((n) => n.kind === 'due').length, MAX_REMINDERS_ANDROID);
  });

  it('plans no last call while reminders are stopped', () => {
    const d = stopReminders(finishOnboarding(defaultData(at(9)), at(9)), at(10));
    assert.deepEqual(planNotifications(d, at(10)), []);
  });
});
