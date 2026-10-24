// Matrix and property tests for the break schedule: time zones and DST, quiet-hour shapes,
// every work interval, seeded random scenarios, and the state changes that feed the schedule.
// Run alone with:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/core/schedule.matrix.test.ts
// Every test sets process.env.TZ itself (Node re-reads it when assigned) and checks the zone
// offset took effect, so the tests don't depend on the machine's zone or on their order.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  atMinuteOfDay,
  cadenceStart,
  dayKey,
  HOUR,
  isQuiet,
  lastQuietEnd,
  MINUTE,
  nextQuietEnd,
  planBreaks,
} from './schedule.ts';
import {
  finishOnboarding,
  resumeReminders,
  skipBreak,
  snooze,
  startBreak,
  stopReminders,
  updateSettings,
} from './transitions.ts';
import {
  BREAK_CHOICES,
  DEFAULT_SETTINGS,
  defaultData,
  SNOOZE_CHOICES,
  WORK_CHOICES,
  type AppData,
  type QuietHours,
  type Settings,
  type TimerState,
} from './types.ts';

const DAY = 24 * HOUR;
const p2 = (n: number) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------------------------
// Zones. `at` is the UTC instant of the clock change. Spring: at local `from` (minutes after
// midnight) the clock skips `len` minutes. Fall: local `from`..`from + len` happens twice.
// Checked against Node's tz data on this machine (2026 transitions).

type Switch = { y: number; mo: number; d: number; at: number; from: number; len: number };
type Zone = { name: string; short: string; jan: number; jul: number; spring: Switch | null; fall: Switch | null };

const ZONES: Zone[] = [
  {
    name: 'Pacific/Auckland',
    short: 'Auckland',
    jan: -780,
    jul: -720,
    spring: { y: 2026, mo: 9, d: 27, at: Date.UTC(2026, 8, 26, 14), from: 120, len: 60 },
    fall: { y: 2026, mo: 4, d: 5, at: Date.UTC(2026, 3, 4, 14), from: 120, len: 60 },
  },
  {
    name: 'America/New_York',
    short: 'New York',
    jan: 300,
    jul: 240,
    spring: { y: 2026, mo: 3, d: 8, at: Date.UTC(2026, 2, 8, 7), from: 120, len: 60 },
    fall: { y: 2026, mo: 11, d: 1, at: Date.UTC(2026, 10, 1, 6), from: 60, len: 60 },
  },
  {
    name: 'Europe/London',
    short: 'London',
    jan: 0,
    jul: -60,
    spring: { y: 2026, mo: 3, d: 29, at: Date.UTC(2026, 2, 29, 1), from: 60, len: 60 },
    fall: { y: 2026, mo: 10, d: 25, at: Date.UTC(2026, 9, 25, 1), from: 60, len: 60 },
  },
  { name: 'Asia/Kolkata', short: 'Kolkata', jan: -330, jul: -330, spring: null, fall: null },
  {
    name: 'Australia/Lord_Howe',
    short: 'Lord Howe',
    jan: -660,
    jul: -630,
    spring: { y: 2026, mo: 10, d: 4, at: Date.UTC(2026, 9, 3, 15, 30), from: 120, len: 30 },
    fall: { y: 2026, mo: 4, d: 5, at: Date.UTC(2026, 3, 4, 15), from: 90, len: 30 },
  },
  {
    name: 'America/St_Johns',
    short: "St John's",
    jan: 210,
    jul: 150,
    spring: { y: 2026, mo: 3, d: 8, at: Date.UTC(2026, 2, 8, 5, 30), from: 120, len: 60 },
    fall: { y: 2026, mo: 11, d: 1, at: Date.UTC(2026, 10, 1, 4, 30), from: 60, len: 60 },
  },
  { name: 'UTC', short: 'UTC', jan: 0, jul: 0, spring: null, fall: null },
];

/** Tests outside the zone matrix run in London on 10 June 2026, far from any clock change. */
const LONDON = ZONES.find((z) => z.name === 'Europe/London')!;

function setZone(z: Zone): void {
  process.env.TZ = z.name;
  assert.equal(new Date(2026, 0, 15, 12).getTimezoneOffset(), z.jan, `${z.name}: January offset (TZ not applied?)`);
  assert.equal(new Date(2026, 6, 15, 12).getTimezoneOffset(), z.jul, `${z.name}: July offset (TZ not applied?)`);
}

// ---------------------------------------------------------------------------------------------
// Time helpers

/** Local wall time in the current zone (month 1-12). Minutes may run past 59. */
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
/** Home zone (London) wall time on 10 June 2026, plus `dd` days. */
const jun = (h: number, mi = 0, dd = 0) => at(2026, 6, 10 + dd, h, mi);

/** Local 'MM-DD HH:MM'. */
function stamp(t: number): string {
  const d = new Date(t);
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

/** Local time to the millisecond with its UTC offset, so repeated wall times stay distinct. */
function zoned(t: number): string {
  const d = new Date(t);
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${stamp(t)}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')} UTC${sign}${p2(Math.floor(a / 60))}:${p2(a % 60)}`;
}

/** The stamp of `min` minutes after midnight starting calendar day y-mo-d, worked out without the time zone. */
function wall(y: number, mo: number, d: number, min: number): string {
  const day = new Date(Date.UTC(y, mo - 1, d) + Math.floor(min / 1440) * DAY);
  const m = ((min % 1440) + 1440) % 1440;
  return `${p2(day.getUTCMonth() + 1)}-${p2(day.getUTCDate())} ${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
}

const fmtMin = (m: number) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
const fmtQuiet = (q: QuietHours) =>
  !q.enabled ? 'off' : q.startMin === q.endMin ? `${fmtMin(q.startMin)}–${fmtMin(q.endMin)} (empty)` : `${fmtMin(q.startMin)}–${fmtMin(q.endMin)}`;
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

// ---------------------------------------------------------------------------------------------
// Settings and state helpers

const quiet = (startMin: number, endMin: number, enabled = true): QuietHours => ({ enabled, startMin, endMin });
const NIGHT = quiet(22 * 60, 8 * 60);
const NO_QUIET = quiet(22 * 60, 8 * 60, false);
const cfg = (q: QuietHours, workMin = 20): Settings => ({ ...DEFAULT_SETTINGS, rule202020: workMin === 20, workMin, quiet: q });
const fresh = (t: number): TimerState => ({ anchor: t, setAt: t, breakEndsAt: null });
const app = (settings: Settings, t: number): AppData => finishOnboarding({ ...defaultData(t), settings }, t);
/** No count cap, so a plan runs to its horizon (8 days at most 2304 reminders, under the loop guard). */
const ALL = { max: 10_000 };

// ---------------------------------------------------------------------------------------------
// Reference model, written from the intended behaviour rather than from schedule.ts.
// Quiet hours change only on whole local minutes and every zone here is a whole number of
// minutes from UTC, so stepping through whole UTC minutes finds every change exactly. Quiet
// hours on a 15-minute grid can step by 15 minutes (all offsets and switches are multiples of it).

/** Is local time `t` in quiet hours? Start is quiet, end is not; empty or disabled means never. */
function quietAt(t: number, q: QuietHours): boolean {
  if (!q.enabled || q.startMin === q.endMin) return false;
  const d = new Date(t);
  const m = d.getHours() * 60 + d.getMinutes();
  return q.startMin < q.endMin ? m >= q.startMin && m < q.endMin : m >= q.startMin || m < q.endMin;
}

/** Instants in (from, to] at which quiet hours end. */
function quietEnds(from: number, to: number, q: QuietHours, step = MINUTE): number[] {
  const out: number[] = [];
  let t = Math.floor(from / step) * step;
  let prev = quietAt(t, q);
  for (t += step; t <= to; t += step) {
    const cur = quietAt(t, q);
    if (prev && !cur && t > from) out.push(t);
    prev = cur;
  }
  return out;
}

/** First instant at or after `t` that isn't quiet. */
function quietOverFrom(t: number, q: QuietHours): number {
  if (!quietAt(t, q)) return t;
  let m = Math.floor(t / MINUTE) * MINUTE + MINUTE;
  while (quietAt(m, q)) m += MINUTE;
  return m;
}

/** Latest instant in (lo, hi] at which quiet hours end, or null. */
function lastEndIn(lo: number, hi: number, q: QuietHours): number | null {
  let m = Math.floor(hi / MINUTE) * MINUTE;
  let cur = quietAt(m, q);
  while (m > lo) {
    const before = quietAt(m - MINUTE, q);
    if (before && !cur) return m;
    m -= MINUTE;
    cur = before;
  }
  return null;
}

/**
 * What planBreaks should return: the cadence runs every workMin from the anchor, or from the
 * last end of quiet hours after setAt; no reminder in quiet hours except a snoozed ring at
 * dueAt; and after any quiet stretch the next reminder is exactly workMin after it ends.
 */
function expectedPlan(now: number, s: Settings, timer: TimerState, opts: { max?: number; horizonMs?: number }) {
  const max = opts.max ?? 60;
  const horizon = now + (opts.horizonMs ?? 8 * DAY);
  const work = s.workMin * MINUTE;
  const q = s.quiet;
  const last = lastEndIn(now - 2 * DAY - 2 * HOUR, now, q);
  // Quiet hours that ended since the timer was set restart the cadence, unless they ended before
  // the anchor (during a break, which anchors at its end) or before a promised snooze rings.
  const restarts = last !== null && last > timer.setAt && last > timer.anchor && !(timer.snoozed && last < timer.anchor + work);
  const start = restarts ? last : timer.anchor;
  const dueAt = start + work;
  const reminders: number[] = [];
  if (timer.paused) return { dueAt, reminders };
  const ring = (t: number) => !!timer.snoozed && start === timer.anchor && t === dueAt;
  let c = dueAt <= now ? dueAt + (Math.floor((now - dueAt) / work) + 1) * work : dueAt;
  let lo = now;
  while (reminders.length < max && c <= horizon) {
    if (!ring(c)) {
      if (quietAt(c, q)) {
        lo = quietOverFrom(c, q);
        c = lo + work;
        continue;
      }
      const e = lastEndIn(lo, c, q);
      if (e !== null) {
        lo = e;
        c = e + work;
        continue;
      }
    }
    reminders.push(c);
    lo = c;
    c += work;
  }
  return { dueAt, reminders };
}

/** Fails with the first differing reminder, in readable local time. */
function sameTimes(actual: number[], expected: number[], what: string): void {
  let i = actual.findIndex((t, k) => t !== expected[k]);
  if (i === -1 && actual.length !== expected.length) i = Math.min(actual.length, expected.length);
  if (i === -1) return;
  const show = (t: number | undefined) => (t === undefined ? 'nothing' : zoned(t));
  assert.fail(
    `${what}: reminder #${i} is ${show(actual[i])}, expected ${show(expected[i])} ` +
      `(previous ${show(actual[i - 1])}; ${actual.length} planned, ${expected.length} expected)`,
  );
}

/** After each quiet stretch the first reminder is end + work, and otherwise reminders are exactly `work` apart. */
function checkCadence(rs: number[], from: number, q: QuietHours, work: number, label: string, step = MINUTE): void {
  if (rs.length === 0) return;
  const ends = quietEnds(from, rs[rs.length - 1]!, q, step);
  for (const e of ends) {
    const r = rs.find((x) => x >= e)!;
    assert.equal(zoned(r), zoned(e + work), `${label}: first reminder after quiet hours ended at ${zoned(e)}`);
  }
  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1]!;
    const b = rs[i]!;
    if (!ends.some((e) => e > a && e <= b)) {
      assert.equal(b - a, work, `${label}: ${zoned(a)} → ${zoned(b)} with no quiet hours between`);
    }
  }
}

function assertNoneQuiet(rs: number[], q: QuietHours, label: string): void {
  const bad = rs.filter((r) => quietAt(r, q));
  assert.deepEqual(bad.map(zoned), [], `${label}: reminders inside quiet hours ${fmtQuiet(q)}`);
}

// =============================================================================================
// 1. Time zones × DST

describe('time zones and clock changes', () => {
  for (const z of ZONES) {
    describe(z.short, () => {
      it(`${z.short}: a normal day reminds every 20 min from 09:20 to 21:40, then at 08:20 the next morning`, () => {
        setZone(z);
        const t0 = at(2026, 6, 10, 9);
        const p = planBreaks(t0, DEFAULT_SETTINGS, fresh(t0), { max: 40 });
        const want = [...range(38).map((k) => wall(2026, 6, 10, 560 + 20 * k)), wall(2026, 6, 11, 500), wall(2026, 6, 11, 520)];
        assert.deepEqual(p.reminders.map(stamp), want);
        for (let i = 1; i < 38; i++) assert.equal(p.reminders[i]! - p.reminders[i - 1]!, 20 * MINUTE);
      });

      const sp = z.spring;
      const fa = z.fall;

      if (sp && fa) {
        it(`${z.short} spring-forward (${sp.mo}/${sp.d}): with 22:00–08:00 quiet, 21:20 and 21:40, then 08:20 after a night ${sp.len} min shorter`, () => {
          setZone(z);
          const eve = at(sp.y, sp.mo, sp.d - 1, 21);
          const p = planBreaks(eve, DEFAULT_SETTINGS, fresh(eve), { max: 4 });
          assert.deepEqual(p.reminders.map(stamp), [-160, -140, 500, 520].map((m) => wall(sp.y, sp.mo, sp.d, m)));
          assert.equal(p.reminders[2]! - p.reminders[1]!, (640 - sp.len) * MINUTE);
          assert.equal(stamp(atMinuteOfDay(eve, 1, 480)), wall(sp.y, sp.mo, sp.d, 480), 'atMinuteOfDay follows the wall clock');
        });

        it(`${z.short} spring-forward: quiet hours spanning the skipped time (${fmtMin(sp.from - 60)}–${fmtMin(sp.from + sp.len + 60)}) hold no reminder; the first after is 20 min past the end`, () => {
          setZone(z);
          const qs = sp.from - 60;
          const qe = sp.from + sp.len + 60;
          const q = quiet(qs, qe);
          const eve = at(sp.y, sp.mo, sp.d - 1, 23);
          const pre: number[] = [];
          for (let m = -40; m < qs; m += 20) pre.push(m);
          const p = planBreaks(eve, cfg(q), fresh(eve), { max: pre.length + 2 });
          assert.deepEqual(p.reminders.map(stamp), [...pre, qe + 20, qe + 40].map((m) => wall(sp.y, sp.mo, sp.d, m)));
          const gap = p.reminders[pre.length]! - p.reminders[pre.length - 1]!;
          assert.equal(gap, (qe + 20 - pre[pre.length - 1]! - sp.len) * MINUTE, 'elapsed time across the shortened quiet hours');
        });

        it(`${z.short} spring-forward: quiet hours ending inside the skipped time (23:00–${fmtMin(sp.from + sp.len / 2)}) end when the clock jumps; next reminder 20 min later`, () => {
          setZone(z);
          const q = quiet(23 * 60, sp.from + sp.len / 2);
          assert.equal(isQuiet(sp.at - 1, q), true, 'quiet just before the jump');
          assert.equal(isQuiet(sp.at, q), false, 'not quiet once the clock has jumped past the end');
          const eve = at(sp.y, sp.mo, sp.d - 1, 22);
          const p = planBreaks(eve, cfg(q), fresh(eve), { max: 4 });
          const later = planBreaks(sp.at + 10 * MINUTE, cfg(q), fresh(eve));
          const back = sp.from + sp.len; // wall time right after the jump
          // new Date() pushes a skipped wall time forward by the size of the gap (New York 02:30 →
          // 03:30, Lord Howe 02:15 → 02:45). nextQuietEnd and lastQuietEnd must instead put the end
          // at the jump, where isQuiet says quiet hours end: the next reminder is 20 min after the
          // jump, not a gap later, and 10 min after the jump the break is not shown as overdue.
          assert.deepEqual(
            { reminders: p.reminders.map(stamp), dueAt10MinAfter: stamp(later.dueAt), overdue10MinAfter: later.overdue },
            {
              reminders: [-100, -80, back + 20, back + 40].map((m) => wall(sp.y, sp.mo, sp.d, m)),
              dueAt10MinAfter: wall(sp.y, sp.mo, sp.d, back + 20),
              overdue10MinAfter: false,
            },
          );
        });

        it(`${z.short} fall-back (${fa.mo}/${fa.d}): with 22:00–08:00 quiet, 21:20 and 21:40, then 08:20 after a night ${fa.len} min longer`, () => {
          setZone(z);
          const eve = at(fa.y, fa.mo, fa.d - 1, 21);
          const p = planBreaks(eve, DEFAULT_SETTINGS, fresh(eve), { max: 4 });
          assert.deepEqual(p.reminders.map(stamp), [-160, -140, 500, 520].map((m) => wall(fa.y, fa.mo, fa.d, m)));
          assert.equal(p.reminders[2]! - p.reminders[1]!, (640 + fa.len) * MINUTE);
          assert.equal(stamp(atMinuteOfDay(eve, 1, 480)), wall(fa.y, fa.mo, fa.d, 480), 'atMinuteOfDay follows the wall clock');
        });

        it(`${z.short} fall-back: quiet hours spanning the repeated time (${fmtMin(fa.from - 60)}–${fmtMin(fa.from + fa.len + 60)}) hold no reminder; the first after is 20 min past the end`, () => {
          setZone(z);
          const qs = fa.from - 60;
          const qe = fa.from + fa.len + 60;
          const q = quiet(qs, qe);
          const eve = at(fa.y, fa.mo, fa.d - 1, 23);
          const pre: number[] = [];
          for (let m = -40; m < qs; m += 20) pre.push(m);
          const p = planBreaks(eve, cfg(q), fresh(eve), { max: pre.length + 2 });
          assert.deepEqual(p.reminders.map(stamp), [...pre, qe + 20, qe + 40].map((m) => wall(fa.y, fa.mo, fa.d, m)));
          const gap = p.reminders[pre.length]! - p.reminders[pre.length - 1]!;
          assert.equal(gap, (qe + 20 - pre[pre.length - 1]! + fa.len) * MINUTE, 'elapsed time across the lengthened quiet hours');
        });

        it(`${z.short} fall-back: quiet hours ending inside the repeated time (23:00–${fmtMin(fa.from + fa.len / 2)}) bring reminders back that morning, not a day later`, () => {
          setZone(z);
          const q = quiet(23 * 60, fa.from + fa.len / 2);
          const secondEnd = fa.at + (fa.len / 2) * MINUTE; // the wall clock reaches the end time for the second time
          assert.equal(isQuiet(secondEnd - 1, q), true, 'the repeated wall time is quiet again');
          assert.equal(isQuiet(secondEnd, q), false, 'quiet hours end at the second pass');
          const eve = at(fa.y, fa.mo, fa.d - 1, 22);
          const p = planBreaks(eve, cfg(q), fresh(eve), { max: 20 });
          const after = p.reminders.find((r) => r > secondEnd);
          const later = planBreaks(secondEnd + 10 * MINUTE, cfg(q), fresh(eve));
          // The wall clock shows the end time twice, and the repeated wall time is quiet again, so
          // quiet hours end at the second pass. nextQuietEnd must find that second end rather than
          // jump to the next day's (which would leave about a day with no reminders), and
          // lastQuietEnd must return it too, so the break isn't shown as overdue 10 min later.
          assert.deepEqual(
            {
              firstAfterQuiet: after === undefined ? 'none' : zoned(after),
              dueAt10MinAfter: zoned(later.dueAt),
              overdue10MinAfter: later.overdue,
            },
            { firstAfterQuiet: zoned(secondEnd + 20 * MINUTE), dueAt10MinAfter: zoned(secondEnd + 20 * MINUTE), overdue10MinAfter: false },
          );
        });

        it(`${z.short}: with no quiet hours, reminders stay exactly 20 min apart through both clock changes`, () => {
          setZone(z);
          const a = at(sp.y, sp.mo, sp.d, 0, sp.from - 60);
          const s = planBreaks(a, cfg(NO_QUIET), fresh(a), { max: 6 });
          const springWant = range(6).map((k) => {
            const m = sp.from - 60 + 20 * (k + 1);
            return wall(sp.y, sp.mo, sp.d, m >= sp.from ? m + sp.len : m);
          });
          assert.deepEqual(s.reminders.map(stamp), springWant, 'spring: wall clock skips ahead');
          const b = at(fa.y, fa.mo, fa.d, 0, fa.from - 60);
          const f = planBreaks(b, cfg(NO_QUIET), fresh(b), { max: 8 });
          const fallWant = range(8).map((k) => {
            const m = fa.from - 60 + 20 * (k + 1);
            return wall(fa.y, fa.mo, fa.d, m < fa.from + fa.len ? m : m - fa.len);
          });
          assert.deepEqual(f.reminders.map(stamp), fallWant, 'fall: wall clock repeats');
          for (const r of [s.reminders, f.reminders]) {
            for (let i = 1; i < r.length; i++) assert.equal(r[i]! - r[i - 1]!, 20 * MINUTE);
          }
        });
      } else {
        it(`${z.short}: no clock changes, so the 21:40 → 08:20 night is 10 h 40 on 8 March and 25 October too`, () => {
          setZone(z);
          for (const [mo, d] of [
            [3, 8],
            [10, 25],
          ] as const) {
            const eve = at(2026, mo, d - 1, 21);
            const p = planBreaks(eve, DEFAULT_SETTINGS, fresh(eve), { max: 4 });
            assert.deepEqual(p.reminders.map(stamp), [-160, -140, 500, 520].map((m) => wall(2026, mo, d, m)));
            assert.equal(p.reminders[2]! - p.reminders[1]!, 640 * MINUTE);
          }
        });
      }

      // Around each clock change (or 8 March and 25 October where there is none), from 10:00
      // three days before, for the whole 8-day horizon.
      const windows = () =>
        (sp && fa ? [sp, fa] : [
          { y: 2026, mo: 3, d: 8 },
          { y: 2026, mo: 10, d: 25 },
        ]).map((w) => at(w.y, w.mo, w.d - 3, 10, 0, 7) + 500);
      const sweepShapes = (): QuietHours[] => [
        NIGHT,
        quiet(0, 6 * 60),
        quiet(60, 5 * 60),
        quiet(23 * 60 + 30, 7 * 60 + 15),
        quiet(12 * 60, 13 * 60),
      ];

      it(`${z.short}: across the clock-change weeks, no reminder lands inside quiet hours`, () => {
        setZone(z);
        const shapes = sweepShapes();
        if (sp) shapes.push(quiet(23 * 60, sp.from + sp.len / 2));
        if (fa) shapes.push(quiet(23 * 60, fa.from + fa.len / 2));
        for (const now of windows()) {
          for (const q of shapes) {
            for (const w of [20, 45, 90]) {
              const p = planBreaks(now, cfg(q, w), fresh(now), ALL);
              const label = `${fmtQuiet(q)}, every ${w} min, from ${zoned(now)}`;
              assert.ok(p.reminders.length > 0, `${label}: some reminders`);
              assertNoneQuiet(p.reminders, q, label);
              for (let i = 1; i < p.reminders.length; i++) assert.ok(p.reminders[i]! > p.reminders[i - 1]!, `${label}: increasing`);
            }
          }
        }
      });

      it(`${z.short}: across the clock-change weeks, the first reminder after quiet hours is exactly workMin after they end`, () => {
        setZone(z);
        for (const now of windows()) {
          for (const q of sweepShapes()) {
            // A 90-min interval can step over the 60-min lunch shape; that case has its own test.
            const works = q.startMin === 12 * 60 ? [20, 45] : [20, 45, 90];
            for (const w of works) {
              const p = planBreaks(now, cfg(q, w), fresh(now), ALL);
              checkCadence(p.reminders, now, q, w * MINUTE, `${fmtQuiet(q)}, every ${w} min`, 15 * MINUTE);
            }
          }
        }
      });

      it(`${z.short}: dayKey gives the local date either side of midnight`, () => {
        setZone(z);
        const julMidnight = Date.UTC(2026, 6, 1) + z.jul * MINUTE; // local 2026-07-01 00:00
        assert.equal(dayKey(julMidnight - 1), '2026-06-30');
        assert.equal(dayKey(julMidnight), '2026-07-01');
        assert.equal(dayKey(julMidnight + DAY - 1), '2026-07-01');
        const newYear = Date.UTC(2026, 0, 1) + z.jan * MINUTE; // local 2026-01-01 00:00
        assert.equal(dayKey(newYear - 1), '2025-12-31');
        assert.equal(dayKey(newYear), '2026-01-01');
        for (const sw of [sp, fa]) {
          if (!sw) continue;
          const key = `${sw.y}-${p2(sw.mo)}-${p2(sw.d)}`;
          assert.equal(dayKey(sw.at - 30 * MINUTE), key, 'before the clock change');
          assert.equal(dayKey(sw.at + 30 * MINUTE), key, 'after the clock change');
        }
      });
    });
  }
});

// =============================================================================================
// 2. Quiet-hour shapes (London, June)

describe('quiet-hour shapes', () => {
  const SHAPES = [
    { name: 'overnight 22:00–08:00', q: quiet(22 * 60, 8 * 60) },
    { name: 'daytime 12:00–13:00', q: quiet(12 * 60, 13 * 60) },
    { name: 'starting at midnight 00:00–06:00', q: quiet(0, 6 * 60) },
    { name: 'ending at midnight 22:00–00:00', q: quiet(22 * 60, 0) },
    { name: 'one minute 12:00–12:01', q: quiet(12 * 60, 12 * 60 + 1) },
    { name: '23 h 30 long 08:30–08:00', q: quiet(8 * 60 + 30, 8 * 60) },
  ];
  // The stretch that starts on 10 June, and the ends of the stretches before and after it.
  const bounds = (q: QuietHours) => {
    const wraps = q.endMin <= q.startMin;
    return {
      start: jun(0, q.startMin),
      end: jun(0, q.endMin, wraps ? 1 : 0),
      prevEnd: jun(0, q.endMin, wraps ? 0 : -1),
      nextEnd: jun(0, q.endMin, wraps ? 2 : 1),
    };
  };

  for (const { name, q } of SHAPES) {
    it(`${name}: isQuiet at the exact boundaries (start is quiet, end is not)`, () => {
      setZone(LONDON);
      const b = bounds(q);
      assert.equal(isQuiet(b.start - 1, q), false, 'a moment before the start');
      assert.equal(isQuiet(b.start, q), true, 'the start');
      assert.equal(isQuiet((b.start + b.end) / 2, q), true, 'the middle');
      assert.equal(isQuiet(b.end - 1, q), true, 'the last moment');
      assert.equal(isQuiet(b.end, q), false, 'the end');
    });

    it(`${name}: lastQuietEnd and nextQuietEnd around the start and end`, () => {
      setZone(LONDON);
      const b = bounds(q);
      const show = (t: number | null) => (t === null ? 'null' : zoned(t));
      assert.equal(show(lastQuietEnd(b.end, q)), zoned(b.end), 'lastQuietEnd at the end is the end');
      assert.equal(show(lastQuietEnd(b.end - 1, q)), zoned(b.prevEnd), 'lastQuietEnd just before the end is the previous end');
      assert.equal(show(lastQuietEnd(b.start, q)), zoned(b.prevEnd), 'lastQuietEnd at the start is the previous end');
      assert.equal(zoned(nextQuietEnd(b.start, q)), zoned(b.end), 'nextQuietEnd from the start');
      assert.equal(zoned(nextQuietEnd(b.end - 1, q)), zoned(b.end), 'nextQuietEnd just before the end');
      assert.equal(zoned(nextQuietEnd(b.end, q)), zoned(b.nextEnd), 'nextQuietEnd at the end is the following end');
    });

    it(`${name}: over three days no reminder is inside, and each quiet stretch is followed by one exactly 20 min after it ends`, () => {
      setZone(LONDON);
      const t0 = jun(9);
      const p = planBreaks(t0, cfg(q), fresh(t0), { ...ALL, horizonMs: 3 * DAY });
      assert.ok(p.reminders.length >= 3);
      assertNoneQuiet(p.reminders, q, name);
      // The one-minute shape is the tricky one: on 10 June the 12:00 candidate is quiet, so the
      // next reminder is 12:21 and the cadence moves to :01/:21/:41. On 11 June a candidate lands
      // exactly on the 12:01 end; it must still count as after quiet hours, giving 12:21. See the
      // next test.
      checkCadence(p.reminders, t0, q, 20 * MINUTE, name);
    });
  }

  for (const [name, q] of [
    ['start equal to end (10:00–10:00)', quiet(10 * 60, 10 * 60)],
    ['disabled', NO_QUIET],
  ] as const) {
    it(`${name}: never quiet, no quiet end, and the plan is the plain 20-min cadence`, () => {
      setZone(LONDON);
      for (let m = 0; m < 1440; m++) assert.equal(isQuiet(jun(0, m), q), false, fmtMin(m));
      assert.equal(lastQuietEnd(jun(23), q), null);
      const t0 = jun(9);
      const p = planBreaks(t0, cfg(q), fresh(t0), ALL);
      assert.equal(p.quietNow, false);
      assert.deepEqual(p.reminders, range(576).map((k) => t0 + (k + 1) * 20 * MINUTE));
    });
  }

  it('one-minute quiet hours (12:00–12:01) between two reminders still restart the cadence: 12:21, not 12:10', () => {
    setZone(LONDON);
    const q = quiet(12 * 60, 12 * 60 + 1);
    const t0 = jun(11, 50);
    const want = [wall(2026, 6, 10, 12 * 60 + 21), wall(2026, 6, 10, 12 * 60 + 41)];
    assert.deepEqual(planBreaks(jun(12, 5), cfg(q), fresh(t0), { max: 2 }).reminders.map(stamp), want, 'planned at 12:05');
    // Quiet hours that start and end between two candidates, or between now and the first one,
    // must not be stepped over: planBreaks restarts the cadence at their end (12:21), as
    // cadenceStart does once now has passed it. So the plan made at 11:50 matches the one at 12:05.
    assert.deepEqual(planBreaks(t0, cfg(q), fresh(t0), { max: 2 }).reminders.map(stamp), want, 'planned at 11:50');
  });

  it('23 h 30 quiet hours (08:30–08:00) with a 20-min interval: exactly one reminder a day, at 08:20', () => {
    setZone(LONDON);
    const t0 = jun(9);
    const p = planBreaks(t0, cfg(quiet(510, 480)), fresh(t0), ALL);
    assert.deepEqual(p.reminders.map(stamp), range(8).map((k) => wall(2026, 6, 11 + k, 500)));
  });

  it('23 h 30 quiet hours with a 45-min interval longer than the 30-min gap: no reminders at all, and planning ends quickly', () => {
    setZone(LONDON);
    const t0 = jun(9);
    const started = performance.now();
    const p = planBreaks(t0, cfg(quiet(510, 480), 45), fresh(t0), ALL);
    assert.deepEqual(p.reminders, []);
    assert.ok(performance.now() - started < 100, 'took too long');
  });
});

// =============================================================================================
// 3. Every work interval (London, June)

describe('work intervals', () => {
  for (const n of WORK_CHOICES) {
    it(`every ${n} min: reminders exactly ${n} min apart; with 22:00–08:00 quiet the evening stops before 22:00 and the morning starts at 08:00 + ${n} min`, () => {
      setZone(LONDON);
      const t0 = jun(9);
      const free = planBreaks(t0, cfg(NO_QUIET, n), fresh(t0), { max: 30 });
      assert.deepEqual(free.reminders, range(30).map((k) => t0 + (k + 1) * n * MINUTE));
      const p = planBreaks(t0, cfg(NIGHT, n), fresh(t0), { ...ALL, horizonMs: 2 * DAY });
      const lastEvening = t0 + Math.floor(779 / n) * n * MINUTE; // last cadence point before 22:00
      const i = p.reminders.indexOf(lastEvening);
      assert.ok(i >= 0, `expected a reminder at ${zoned(lastEvening)}`);
      assert.equal(zoned(p.reminders[i + 1]!), zoned(jun(8, n, 1)));
      assert.equal(p.reminders[0], t0 + n * MINUTE);
      assertNoneQuiet(p.reminders, NIGHT, `every ${n}`);
      checkCadence(p.reminders, t0, NIGHT, n * MINUTE, `every ${n}`);
    });

    it(`every ${n} min: at most 60 (default) or 150 reminders within 8 days, and a 6 h horizonMs keeps exactly the ones up to its edge`, () => {
      setZone(LONDON);
      const t0 = jun(9) + 1234;
      const s = cfg(NO_QUIET, n);
      const fit = Math.floor((8 * 1440) / n);
      assert.equal(planBreaks(t0, s, fresh(t0)).reminders.length, Math.min(60, fit), 'default max');
      for (const max of [60, 150]) {
        const p = planBreaks(t0, s, fresh(t0), { max });
        assert.equal(p.reminders.length, Math.min(max, fit), `max ${max}`);
        assert.ok(p.reminders[p.reminders.length - 1]! <= t0 + 8 * DAY, `max ${max}: within 8 days`);
      }
      const h = planBreaks(t0, s, fresh(t0), { max: 999, horizonMs: 6 * HOUR });
      const k = Math.floor(360 / n);
      assert.equal(h.reminders.length, k, 'horizon count');
      assert.equal(h.reminders[k - 1], t0 + k * n * MINUTE, 'last reminder, kept when exactly at the edge');
    });
  }

  for (const [n, anchorMin, before] of [
    [75, 10 * 60 + 30, 11 * 60 + 45],
    [90, 10 * 60 + 20, 11 * 60 + 50],
  ] as const) {
    it(`every ${n} min: a 12:00–13:00 lunch quiet hour that fits between two reminders still restarts the cadence at 13:00 + ${n} min`, () => {
      setZone(LONDON);
      const q = quiet(12 * 60, 13 * 60);
      const anchor = jun(0, anchorMin);
      const want = [before, 13 * 60 + n, 13 * 60 + 2 * n].map((m) => wall(2026, 6, 10, m));
      // Like the one-minute quiet hours above. Every 75 min from 10:30: 11:45, then 13:00 lands
      // exactly on the end of quiet hours, so the next is 14:15. Every 90 min from 10:20: 11:50,
      // then 13:20 would step over lunch, so the next is 14:30. Planning at 13:05 agrees.
      assert.deepEqual(planBreaks(anchor, cfg(q, n), fresh(anchor), { max: 3 }).reminders.map(stamp), want);
    });
  }
});

// =============================================================================================
// 4. Seeded property tests

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

type Opts = { max?: number; horizonMs?: number };
type Scenario = { name: string; zone: Zone; now: number; settings: Settings; timer: TimerState; opts: Opts };

const OPTS: Opts[] = [
  {},
  {},
  { max: 0 },
  { max: 1 },
  { max: 5 },
  { max: 150 },
  { horizonMs: 30 * MINUTE },
  { horizonMs: 6 * HOUR },
  { max: 150, horizonMs: DAY },
  { max: 150, horizonMs: 3 * DAY },
];

// MATRIX_SEED and MATRIX_SCENARIOS explore new cases; the defaults keep every run the same.
const SCENARIO_SEED = Number(process.env.MATRIX_SEED) || 0x5eed;
const SCENARIOS = Number(process.env.MATRIX_SCENARIOS) || 60;

function makeScenario(i: number): Scenario {
  const rand = mulberry32((SCENARIO_SEED + i * 7919) >>> 0);
  const int = (n: number) => Math.floor(rand() * n);
  const pick = <T,>(list: readonly T[]): T => list[int(list.length)]!;
  const randomQuiet = (): QuietHours => {
    const r = rand();
    if (r < 0.12) return quiet(int(1440), int(1440), false);
    if (r < 0.17) {
      const m = int(1440);
      return quiet(m, m);
    }
    const grid = rand() < 0.5 ? 15 : 1;
    const start = int(1440 / grid) * grid;
    const len = (1 + int(1440 / grid - 1)) * grid;
    return quiet(start, (start + len) % 1440);
  };

  const zone = ZONES[i % ZONES.length]!;
  setZone(zone);
  const switches = [zone.spring, zone.fall].filter((s): s is Switch => s !== null);
  const now =
    switches.length > 0 && rand() < 0.35
      ? pick(switches).at - 36 * HOUR + int(3 * DAY)
      : Date.UTC(2026, 0, 1) + int(365 * DAY);

  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    rule202020: false,
    workMin: pick(WORK_CHOICES),
    breakSec: pick(BREAK_CHOICES),
    snoozeMin: pick(SNOOZE_CHOICES),
    quiet: randomQuiet(),
  };
  let t = now - int(3 * DAY);
  let data = app(settings, t);
  const steps = int(5);
  for (let k = 0; k < steps; k++) {
    t += Math.floor(rand() * (now - t));
    const action = pick(['snooze', 'break', 'skip', 'stop', 'resume', 'work', 'quiet'] as const);
    if (action === 'snooze') data = snooze(data, t);
    else if (action === 'break') data = startBreak(data, t);
    else if (action === 'skip') data = skipBreak(data, t);
    else if (action === 'stop') data = stopReminders(data, t);
    else if (action === 'resume') data = resumeReminders(data, t);
    else if (action === 'work') data = updateSettings(data, { workMin: pick(WORK_CHOICES) }, t);
    else data = updateSettings(data, { quiet: randomQuiet() }, t);
  }
  if (rand() < 0.15) data = startBreak(data, now - int(data.settings.breakSec * 1000));
  const opts = pick(OPTS);

  const tm = data.timer;
  const state = tm.paused
    ? 'stopped'
    : tm.breakEndsAt !== null && tm.breakEndsAt > now
      ? 'on a break'
      : tm.snoozed
        ? 'snoozed'
        : 'running';
  const optsText = [opts.max !== undefined && `max ${opts.max}`, opts.horizonMs !== undefined && `horizon ${opts.horizonMs / MINUTE} min`]
    .filter(Boolean)
    .join(', ');
  const name =
    `#${i + 1} ${zone.short} ${stamp(now)}: every ${data.settings.workMin} min, quiet ${fmtQuiet(data.settings.quiet)}, ` +
    `${state}${optsText ? `, ${optsText}` : ''}`;
  return { name, zone, now, settings: data.settings, timer: tm, opts };
}

function checkInvariants({ now, settings: s, timer, opts }: Scenario): void {
  const p = planBreaks(now, s, timer, opts);
  const q = s.quiet;
  const work = s.workMin * MINUTE;
  const max = opts.max ?? 60;
  const horizon = now + (opts.horizonMs ?? 8 * DAY);
  const exp = expectedPlan(now, s, timer, opts);

  assert.equal(p.quietNow, quietAt(now, q), 'quietNow');
  assert.equal(p.breakActive, timer.breakEndsAt !== null && timer.breakEndsAt > now, 'breakActive: a break runs until breakEndsAt');
  assert.equal(p.dueAt, cadenceStart(now, timer, q, work) + work, 'dueAt is cadenceStart + workMin');
  assert.equal(zoned(p.dueAt), zoned(exp.dueAt), 'dueAt: the cadence restarts at the last end of quiet hours after setAt and the anchor');
  if (timer.paused) {
    assert.deepEqual(p.reminders, [], 'paused: no reminders');
    assert.equal(p.overdue, false, 'paused: not overdue');
    return;
  }
  // Only the snooze the user asked for rings in quiet hours: once quiet hours have restarted the
  // cadence, dueAt is no longer that snooze, whatever the flag says.
  const snoozePending = !!timer.snoozed && p.dueAt === timer.anchor + work;
  assert.equal(p.overdue, !p.breakActive && now >= p.dueAt && (!p.quietNow || snoozePending), 'overdue');
  assert.ok(p.reminders.length <= max, `at most max (${max}) reminders`);
  p.reminders.forEach((r, i) => {
    assert.ok(r > now, `reminder #${i} ${zoned(r)} is after now`);
    assert.ok(r <= horizon, `reminder #${i} ${zoned(r)} is within the horizon`);
    if (i > 0) assert.ok(r > p.reminders[i - 1]!, `reminder #${i} ${zoned(r)} is after the one before`);
  });
  const snoozeRing = (r: number) => snoozePending && r === p.dueAt;
  assert.deepEqual(
    p.reminders.filter((r) => quietAt(r, q) && !snoozeRing(r)).map(zoned),
    [],
    'no reminder in quiet hours, except a snoozed ring at dueAt',
  );
  sameTimes(p.reminders, exp.reminders, 'reminders every workMin, back exactly workMin after quiet hours end, up to max and the horizon');
}

describe(`property: ${SCENARIOS} seeded random scenarios`, () => {
  // #57 is a tricky one (Auckland 5 Aug 10:57, every 50 min, quiet 14:37–11:12): now is inside
  // quiet hours 15 min before they end, and the first cadence point after now (11:22) is past the
  // 11:12 end and not quiet. The next reminder must still be 11:12 + 50 = 12:02, as in the
  // one-minute quiet hours test.
  for (let i = 0; i < SCENARIOS; i++) {
    const sc = makeScenario(i);
    it(sc.name, (t) => {
      setZone(sc.zone);
      if (boundaryRepeats(sc)) {
        t.skip('a quiet-hours edge inside the hour repeated when the clocks go back: see the clock-change tests');
        return;
      }
      checkInvariants(sc);
    });
  }
});

/**
 * A quiet-hours start or end inside the hour the clocks repeat when they go back, near the
 * scenario. Planning keeps quiet hours from the first time their start comes round to the last
 * time their end does, so they never end twice. quietAt here only reads the wall clock, which
 * ends them at the first of the two times and starts them again when the hour repeats. The
 * clock-change tests above check those nights against the planning rule itself.
 */
function boundaryRepeats({ zone, now, settings: s, opts }: Scenario): boolean {
  const f = zone.fall;
  const q = s.quiet;
  if (!f || !q.enabled || f.at < now - 4 * DAY || f.at > now + (opts.horizonMs ?? 8 * DAY) + DAY) return false;
  const inRepeat = (m: number) => m >= f.from && m < f.from + f.len;
  return inRepeat(q.startMin) || inRepeat(q.endMin);
}

// =============================================================================================
// 5. States and transitions (London, June, quiet 22:00–08:00)

describe('states and transitions', () => {
  const ready = () => app(cfg(NIGHT), jun(9));

  it('snooze into quiet hours: rings once at 22:03, then 08:20 the next morning', () => {
    setZone(LONDON);
    const d = snooze(ready(), jun(21, 58));
    const p = planBreaks(jun(21, 58), d.settings, d.timer, ALL);
    assert.deepEqual(p.reminders.slice(0, 3).map(stamp), ['06-10 22:03', '06-11 08:20', '06-11 08:40']);
    assert.deepEqual(p.reminders.filter((r) => quietAt(r, NIGHT)).map(stamp), ['06-10 22:03'], 'only the snooze is in quiet hours');
  });

  it('snooze into quiet hours, ignored: overdue, but nothing more rings until 08:20', () => {
    setZone(LONDON);
    const d = snooze(ready(), jun(21, 58));
    const p = planBreaks(jun(22, 10), d.settings, d.timer, ALL);
    assert.equal(p.quietNow, true);
    assert.equal(p.overdue, true);
    assert.equal(stamp(p.dueAt), '06-10 22:03');
    assert.equal(stamp(p.reminders[0]!), '06-11 08:20');
    assertNoneQuiet(p.reminders, NIGHT, 'after the snooze rang');
  });

  it('snoozing again in quiet hours rings again after snoozeMin', () => {
    setZone(LONDON);
    const d = snooze(snooze(ready(), jun(21, 58)), jun(22, 10));
    const p = planBreaks(jun(22, 10), d.settings, d.timer, { max: 2 });
    assert.deepEqual(p.reminders.map(stamp), ['06-10 22:15', '06-11 08:20']);
  });

  it('a snooze landing exactly on the start of quiet hours (22:00) rings, and is overdue at 22:00', () => {
    setZone(LONDON);
    const d = snooze(ready(), jun(21, 55));
    assert.deepEqual(planBreaks(jun(21, 55), d.settings, d.timer, { max: 2 }).reminders.map(stamp), ['06-10 22:00', '06-11 08:20']);
    assert.equal(planBreaks(jun(22), d.settings, d.timer).overdue, true);
  });

  it('a snooze at 07:58, just before quiet hours end, rings at 08:03 whether planned at 07:58 or at 08:01', () => {
    setZone(LONDON);
    const d = snooze(ready(), jun(7, 58, 1));
    const want = ['06-11 08:03', '06-11 08:23'];
    assert.deepEqual(planBreaks(jun(7, 58, 1), d.settings, d.timer, { max: 2 }).reminders.map(stamp), want, 'planned at 07:58');
    // Quiet hours end at 08:00, after the snooze was set (07:58) but before it rings (08:03).
    // cadenceStart keeps a pending snooze rather than restarting the cadence at the end, so a
    // plan made after 08:00 still rings at 08:03, not 08:20.
    assert.deepEqual(planBreaks(jun(8, 1, 1), d.settings, d.timer, { max: 2 }).reminders.map(stamp), want, 'planned at 08:01');
  });

  it('a snooze at 07:58 that rang at 08:03 is overdue at 08:04', () => {
    setZone(LONDON);
    const d = snooze(ready(), jun(7, 58, 1));
    const p = planBreaks(jun(8, 4, 1), d.settings, d.timer);
    // As above: the 08:03 notification was booked at 07:58, so at 08:04 the plan agrees with
    // the ring (dueAt 08:03, overdue).
    assert.deepEqual({ dueAt: stamp(p.dueAt), overdue: p.overdue }, { dueAt: '06-11 08:03', overdue: true });
  });

  it('a snooze at the moment quiet hours end (08:00) rings at 08:05, then every 20 min', () => {
    setZone(LONDON);
    const d = snooze(ready(), jun(8, 0, 1));
    for (const now of [jun(8, 0, 1), jun(8, 2, 1)]) {
      assert.deepEqual(planBreaks(now, d.settings, d.timer, { max: 2 }).reminders.map(stamp), ['06-11 08:05', '06-11 08:25']);
    }
  });

  it('stopped: no reminders and never overdue, hours after dueAt or in quiet hours', () => {
    setZone(LONDON);
    const d = stopReminders(ready(), jun(10));
    const day = planBreaks(jun(15), d.settings, d.timer);
    assert.deepEqual({ reminders: day.reminders, overdue: day.overdue, quietNow: day.quietNow }, { reminders: [], overdue: false, quietNow: false });
    const night = planBreaks(jun(23), d.settings, d.timer);
    assert.deepEqual({ reminders: night.reminders, overdue: night.overdue, quietNow: night.quietNow }, { reminders: [], overdue: false, quietNow: true });
  });

  it('stopped with a break running: the break is active, but nothing is planned during or after it', () => {
    setZone(LONDON);
    const d = startBreak(stopReminders(ready(), jun(10)), jun(11));
    assert.equal(d.timer.paused, true);
    const during = planBreaks(jun(11) + 5_000, d.settings, d.timer);
    assert.deepEqual({ breakActive: during.breakActive, overdue: during.overdue, reminders: during.reminders }, { breakActive: true, overdue: false, reminders: [] });
    const after = planBreaks(jun(12), d.settings, d.timer);
    assert.deepEqual({ breakActive: after.breakActive, overdue: after.overdue, reminders: after.reminders }, { breakActive: false, overdue: false, reminders: [] });
  });

  it('a running break is active until breakEndsAt (exclusive) and is never overdue', () => {
    setZone(LONDON);
    const d = startBreak(ready(), jun(10));
    const ends = d.timer.breakEndsAt!;
    assert.equal(planBreaks(ends - 1, d.settings, d.timer).breakActive, true);
    assert.equal(planBreaks(ends, d.settings, d.timer).breakActive, false);
    // A break running after the due time (state as restored from storage) holds off "overdue".
    const late: TimerState = { anchor: jun(9), setAt: jun(9), breakEndsAt: jun(10) + 20_000 };
    const during = planBreaks(jun(10), d.settings, late);
    assert.deepEqual({ breakActive: during.breakActive, overdue: during.overdue }, { breakActive: true, overdue: false });
    assert.equal(planBreaks(jun(10) + 20_000, d.settings, late).overdue, true, 'overdue once the break is over');
  });

  it('a break started in quiet hours (23:00): active, not overdue, next reminder 08:20', () => {
    setZone(LONDON);
    const d = startBreak(ready(), jun(23));
    const p = planBreaks(jun(23) + 5_000, d.settings, d.timer, { max: 1 });
    assert.deepEqual(
      { breakActive: p.breakActive, quietNow: p.quietNow, overdue: p.overdue, next: p.reminders.map(stamp) },
      { breakActive: true, quietNow: true, overdue: false, next: ['06-11 08:20'] },
    );
  });

  it('skipping during quiet hours (23:30): not overdue, next reminder 08:20', () => {
    setZone(LONDON);
    const d = skipBreak(ready(), jun(23, 30));
    const p = planBreaks(jun(23, 30), d.settings, d.timer, { max: 2 });
    assert.equal(p.overdue, false);
    assert.deepEqual(p.reminders.map(stamp), ['06-11 08:20', '06-11 08:40']);
  });

  it('skipping at 07:50, ten minutes before quiet hours end: next reminder 08:20, not 08:10', () => {
    setZone(LONDON);
    const d = skipBreak(ready(), jun(7, 50, 1));
    const want = ['06-11 08:20', '06-11 08:40'];
    assert.deepEqual(planBreaks(jun(8, 1, 1), d.settings, d.timer, { max: 2 }).reminders.map(stamp), want, 'planned at 08:01');
    // The first candidate (07:50 + 20 = 08:10) is past the 08:00 end and not quiet, but quiet
    // hours ended before it, so the cadence restarts at 08:00: 08:20, as planned after 08:00.
    assert.deepEqual(planBreaks(jun(7, 50, 1), d.settings, d.timer, { max: 2 }).reminders.map(stamp), want, 'planned at 07:50');
  });

  it('resuming in quiet hours (02:00): nothing until 08:20', () => {
    setZone(LONDON);
    const d = resumeReminders(stopReminders(ready(), jun(21)), jun(2, 0, 1));
    const p = planBreaks(jun(2, 0, 1), d.settings, d.timer, { max: 2 });
    assert.equal(p.overdue, false);
    assert.deepEqual(p.reminders.map(stamp), ['06-11 08:20', '06-11 08:40']);
  });

  it('resuming at 07:50, ten minutes before quiet hours end: first reminder 08:20, the same as planning again at 08:01', () => {
    setZone(LONDON);
    const d = resumeReminders(stopReminders(ready(), jun(21)), jun(7, 50, 1));
    const want = ['06-11 08:20', '06-11 08:40'];
    assert.deepEqual(planBreaks(jun(8, 1, 1), d.settings, d.timer, { max: 2 }).reminders.map(stamp), want, 'planned at 08:01');
    // Same as skipping at 07:50: the plan made when resuming must give 08:20, not 08:10.
    assert.deepEqual(planBreaks(jun(7, 50, 1), d.settings, d.timer, { max: 2 }).reminders.map(stamp), want, 'planned at 07:50');
  });

  it('a timer set at 21:00 plans 08:20 for the morning, whether planned at 21:00 or again at 07:50', () => {
    setZone(LONDON);
    const t = fresh(jun(21));
    assert.equal(stamp(planBreaks(jun(21), cfg(NIGHT), t, { max: 3 }).reminders[2]!), '06-11 08:20', 'planned at 21:00');
    // The app re-plans whenever it wakes. At 07:50 the first point of the evening cadence after
    // now is 08:00, exactly the end of quiet hours (not itself quiet); the reminder must still be
    // 08:20, not the moment quiet hours end.
    assert.equal(stamp(planBreaks(jun(7, 50, 1), cfg(NIGHT), t, { max: 1 }).reminders[0]!), '06-11 08:20', 'planned at 07:50');
  });

  it('onboarding during quiet hours (23:00): first reminder 08:20', () => {
    setZone(LONDON);
    const d = app(cfg(NIGHT), jun(23));
    assert.deepEqual(planBreaks(jun(23), d.settings, d.timer, { max: 1 }).reminders.map(stamp), ['06-11 08:20']);
  });

  it('updateSettings with a new workMin re-anchors from now: 60 → 45 at 10:07 is not overdue and next rings at 10:52', () => {
    setZone(LONDON);
    const d = app({ ...cfg(NIGHT, 60), rule202020: false }, jun(9));
    assert.equal(planBreaks(jun(10, 7), d.settings, d.timer).overdue, true, 'the old cadence was overdue');
    const u = updateSettings(d, { workMin: 45 }, jun(10, 7));
    assert.deepEqual(u.timer, { anchor: jun(10, 7), setAt: jun(10, 7), breakEndsAt: null });
    const p = planBreaks(jun(10, 7), u.settings, u.timer, { max: 1 });
    assert.deepEqual({ overdue: p.overdue, next: p.reminders.map(stamp) }, { overdue: false, next: ['06-10 10:52'] });
  });

  it('updateSettings with a new workMin during a break re-anchors from the end of the break', () => {
    setZone(LONDON);
    const d = startBreak(ready(), jun(10));
    const u = updateSettings(d, { rule202020: false, workMin: 30 }, jun(10) + 5_000);
    assert.equal(u.timer.anchor, jun(10) + 20_000);
    assert.equal(u.timer.breakEndsAt, jun(10) + 20_000);
    const p = planBreaks(jun(10) + 5_000, u.settings, u.timer, { max: 1 });
    assert.equal(p.breakActive, true);
    assert.equal(zoned(p.reminders[0]!), zoned(jun(10, 30) + 20_000));
  });

  it('updateSettings without a workMin change keeps the timer and anchor as they were', () => {
    setZone(LONDON);
    const d = snooze(ready(), jun(10));
    const patches: Partial<Settings>[] = [
      { breakSec: 60 },
      { snoozeMin: 15 },
      { quiet: quiet(23 * 60, 7 * 60) },
      { quiet: NO_QUIET },
      { startSound: 'chime', endVibrate: false },
      { trayTimer: false, haptics: false },
      { workMin: 20 },
    ];
    for (const patch of patches) {
      const u = updateSettings(d, patch, jun(10, 3));
      assert.equal(u.timer, d.timer, JSON.stringify(patch));
      assert.deepEqual(u.settings, { ...d.settings, ...patch });
    }
  });

  it('updateSettings with a new workMin while stopped keeps reminders stopped', () => {
    setZone(LONDON);
    const u = updateSettings(stopReminders(ready(), jun(10)), { rule202020: false, workMin: 30 }, jun(10, 5));
    assert.equal(u.timer.paused, true);
    assert.deepEqual(planBreaks(jun(12), u.settings, u.timer).reminders, []);
  });

  it('stopping during a break ends the break and plans nothing', () => {
    setZone(LONDON);
    const d = stopReminders(startBreak(ready(), jun(10)), jun(10) + 5_000);
    const p = planBreaks(jun(10) + 6_000, d.settings, d.timer);
    assert.deepEqual({ breakActive: p.breakActive, overdue: p.overdue, reminders: p.reminders }, { breakActive: false, overdue: false, reminders: [] });
  });
});

// =============================================================================================
// 6. Edge inputs (London, June)

describe('edge inputs', () => {
  it('now exactly at dueAt: overdue, and the next reminder is one interval later', () => {
    setZone(LONDON);
    const t0 = jun(10);
    const p = planBreaks(t0 + 20 * MINUTE, cfg(NIGHT), fresh(t0), { max: 1 });
    assert.deepEqual({ dueAt: p.dueAt, overdue: p.overdue, next: p.reminders }, { dueAt: t0 + 20 * MINUTE, overdue: true, next: [t0 + 40 * MINUTE] });
  });

  it('1 ms before dueAt: not overdue, and the next reminder is dueAt', () => {
    setZone(LONDON);
    const t0 = jun(10);
    const p = planBreaks(t0 + 20 * MINUTE - 1, cfg(NIGHT), fresh(t0), { max: 1 });
    assert.deepEqual({ overdue: p.overdue, next: p.reminders }, { overdue: false, next: [t0 + 20 * MINUTE] });
  });

  it('anchor six weeks back with no quiet hours, every 5 min: the next reminder is the next cadence point, computed fast', () => {
    setZone(LONDON);
    const now = jun(10);
    const anchor = now - 6 * 7 * DAY + 1234;
    const work = 5 * MINUTE;
    const next = anchor + (Math.floor((now - anchor) / work) + 1) * work;
    const s = cfg(NO_QUIET, 5);
    const started = performance.now();
    for (let i = 0; i < 200; i++) planBreaks(now, s, fresh(anchor));
    assert.ok(performance.now() - started < 500, '200 plans took too long');
    const p = planBreaks(now, s, fresh(anchor));
    assert.equal(p.reminders.length, 60);
    assert.equal(zoned(p.reminders[0]!), zoned(next));
    assert.ok(p.reminders[0]! - now <= work);
    assert.equal(p.overdue, true);
  });

  it('anchor three weeks back with 22:00–08:00 quiet: the cadence restarts at 08:00 today', () => {
    setZone(LONDON);
    const old = jun(10, 7) - 21 * DAY;
    const p = planBreaks(jun(10, 5), cfg(NIGHT), fresh(old), { max: 2 });
    assert.deepEqual(
      { dueAt: stamp(p.dueAt), overdue: p.overdue, next: p.reminders.map(stamp) },
      { dueAt: '06-10 08:20', overdue: true, next: ['06-10 10:20', '06-10 10:40'] },
    );
  });

  it('max 0: no reminders, but dueAt and overdue are still reported', () => {
    setZone(LONDON);
    const t0 = jun(10);
    const p = planBreaks(t0 + 25 * MINUTE, cfg(NIGHT), fresh(t0), { max: 0 });
    assert.deepEqual({ reminders: p.reminders, dueAt: p.dueAt, overdue: p.overdue }, { reminders: [], dueAt: t0 + 20 * MINUTE, overdue: true });
  });

  it('horizonMs (5 min) shorter than workMin: nothing when the next reminder is 15 min away', () => {
    setZone(LONDON);
    const t0 = jun(10);
    assert.deepEqual(planBreaks(t0 + 5 * MINUTE, cfg(NIGHT), fresh(t0), { horizonMs: 5 * MINUTE }).reminders, []);
  });

  it('horizonMs (5 min) shorter than workMin: exactly one reminder when it is 3 min away', () => {
    setZone(LONDON);
    const t0 = jun(10);
    assert.deepEqual(planBreaks(t0 + 17 * MINUTE, cfg(NIGHT), fresh(t0), { horizonMs: 5 * MINUTE }).reminders, [t0 + 20 * MINUTE]);
  });
});
