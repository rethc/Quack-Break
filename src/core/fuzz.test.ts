// Randomized state-machine (fuzz) tests for the core logic. Each walk starts from a fresh
// onboarding with random valid settings and takes 200–400 random steps: time passing (seconds to
// days, sometimes exactly onto a reminder, a break end, a quiet-hours edge or a clock change),
// break actions, stop/resume, settings changes as the Settings screen makes them, pet actions,
// storage round-trips, and now and then the clock going back. After every step it checks
// invariants on the state, on planBreaks and on planNotifications, against a reference model of
// quiet hours built independently of schedule.ts (from UTC offsets, not from Date normalization).
// Run alone with:
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test src/core/fuzz.test.ts
// Every test sets process.env.TZ itself (Node re-reads it when assigned) and checks the offset.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MAX_REMINDERS, MAX_REMINDERS_ANDROID, planNotifications, type PlannedNotification } from './notificationPlan.ts';
import { cleanName, ITEMS, MAX_NAME_LENGTH, MIN_GAP_MS, pondFrom, type ItemId } from './pond.ts';
import { HOUR, isQuiet, lastQuietEnd, MINUTE, planBreaks, type BreakPlan } from './schedule.ts';
import {
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

const SEC = 1000;
const DAY = 24 * HOUR;
/** planBreaks' default horizon. */
const HORIZON = 8 * DAY;
const KEEP_DAYS = 400;

// ---------------------------------------------------------------------------------------------
// Random numbers (seeded, so every walk runs the same every time)

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

type Rand = {
  next: () => number;
  int: (lo: number, hi: number) => number;
  pick: <T>(list: readonly T[]) => T;
  chance: (p: number) => boolean;
};

function makeRand(seed: number): Rand {
  const next = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  return { next, int, pick: (list) => list[Math.floor(next() * list.length)]!, chance: (p) => next() < p };
}

// ---------------------------------------------------------------------------------------------
// Zones. `switches` are the UTC instants of the 2026 clock changes.

type Zone = { name: string; jan: number; jul: number; switches: number[] };

const ZONES: Zone[] = [
  { name: 'Pacific/Auckland', jan: -780, jul: -720, switches: [Date.UTC(2026, 3, 4, 14), Date.UTC(2026, 8, 26, 14)] },
  { name: 'America/New_York', jan: 300, jul: 240, switches: [Date.UTC(2026, 2, 8, 7), Date.UTC(2026, 10, 1, 6)] },
  { name: 'Europe/London', jan: 0, jul: -60, switches: [Date.UTC(2026, 2, 29, 1), Date.UTC(2026, 9, 25, 1)] },
  {
    name: 'Australia/Lord_Howe',
    jan: -660,
    jul: -630,
    switches: [Date.UTC(2026, 3, 4, 15), Date.UTC(2026, 9, 3, 15, 30)],
  },
  { name: 'UTC', jan: 0, jul: 0, switches: [] },
];

const zoneNamed = (name: string) => ZONES.find((z) => z.name === name)!;

function setZone(z: Zone): void {
  process.env.TZ = z.name;
  assert.equal(new Date(2026, 0, 15, 12).getTimezoneOffset(), z.jan, `${z.name}: January offset (TZ not applied?)`);
  assert.equal(new Date(2026, 6, 15, 12).getTimezoneOffset(), z.jul, `${z.name}: July offset (TZ not applied?)`);
  for (const sw of z.switches) {
    assert.notEqual(new Date(sw - 1).getTimezoneOffset(), new Date(sw).getTimezoneOffset(), `${z.name}: clock change at ${new Date(sw).toISOString()}`);
  }
}

// ---------------------------------------------------------------------------------------------
// Formatting

const p2 = (n: number) => String(n).padStart(2, '0');

/** Local date and time to the millisecond with its UTC offset, so repeated wall times stay distinct. */
function zoned(t: number): string {
  const d = new Date(t);
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:` +
    `${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')} UTC${sign}${p2(Math.floor(a / 60))}:${p2(a % 60)}`
  );
}

const fmtMin = (m: number) => `${p2(Math.floor(m / 60))}:${p2(m % 60)}`;
const fmtQuiet = (q: QuietHours) => `${q.enabled ? 'on' : 'off'} ${fmtMin(q.startMin)}–${fmtMin(q.endMin)}`;
const fmtTimes = (ts: readonly number[], n = 6) =>
  ts.length === 0 ? '[]' : `[${ts.slice(0, n).map(zoned).join(', ')}${ts.length > n ? `, … (${ts.length} in all)` : ''}]`;

/** Local calendar date, YYYY-MM-DD (written here rather than taken from schedule.ts). */
function localDate(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

// ---------------------------------------------------------------------------------------------
// Reference model of quiet hours, independent of schedule.ts. The wall clock at `t` is
// t - offset(t). A wall time that happens twice (clocks went back) is quiet from its first
// start to its last end; a wall time that never happens (clocks went forward) is the moment the
// clock jumped past it. Quiet hours are the union of each day's span [start, end), so the
// moments they end are the ends of the merged intervals.

type Interval = [number, number];

/** The local wall clock at `t`, read as a UTC timestamp. */
const wallOf = (t: number) => t - new Date(t).getTimezoneOffset() * MINUTE;
/** Days since 1970-01-01 of the local date at `t`. */
const dayNumberOf = (t: number) => Math.floor(wallOf(t) / DAY);

/** Every instant at which the wall clock shows minute `min` of local day `dn`: none, one or two. */
function wallInstants(dn: number, min: number): number[] {
  const w = dn * DAY + min * MINUTE;
  const offsets = new Set<number>();
  for (let k = -2; k <= 2; k++) offsets.add(new Date(w + k * 12 * HOUR).getTimezoneOffset());
  const out: number[] = [];
  for (const o of offsets) {
    const c = w + o * MINUTE;
    if (wallOf(c) === w) out.push(c);
  }
  return out.sort((a, b) => a - b);
}

/** The first instant whose wall clock is past `w` (a wall time the clocks skipped). */
function jumpPast(w: number): number {
  let lo = w - 15 * HOUR;
  let hi = w + 15 * HOUR;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (wallOf(mid) > w) hi = mid;
    else lo = mid;
  }
  return hi;
}

function firstAt(dn: number, min: number): number {
  return wallInstants(dn, min)[0] ?? jumpPast(dn * DAY + min * MINUTE);
}

function lastAt(dn: number, min: number): number {
  return wallInstants(dn, min).at(-1) ?? jumpPast(dn * DAY + min * MINUTE);
}

/** Quiet hours starting on local day `dn`. */
function daySpan(dn: number, q: QuietHours): Interval {
  return [firstAt(dn, q.startMin), lastAt(q.startMin < q.endMin ? dn : dn + 1, q.endMin)];
}

type QuietModel = { intervals: (q: QuietHours, now: number) => Interval[] };

/** Merged quiet intervals covering [now - 3 days, now + 10 days], cached per walk. */
function quietModel(): QuietModel {
  const spans = new Map<string, Interval>();
  let lastKey = '';
  let last: Interval[] = [];
  return {
    intervals(q, now) {
      if (!q.enabled || q.startMin === q.endMin) return [];
      const lo = dayNumberOf(now - 3 * DAY) - 1;
      const hi = dayNumberOf(now + 10 * DAY) + 1;
      const key = `${q.startMin}|${q.endMin}|${lo}|${hi}`;
      if (key === lastKey) return last;
      const list: Interval[] = [];
      for (let dn = lo; dn <= hi; dn++) {
        const k = `${q.startMin}|${q.endMin}|${dn}`;
        let s = spans.get(k);
        if (!s) {
          s = daySpan(dn, q);
          spans.set(k, s);
        }
        // An empty span (start and end both skipped by the clocks going forward) is never
        // quiet, but is kept as a moment quiet hours "ended": whether that should restart the
        // cadence is unclear (see the report), so the model agrees with schedule.ts there.
        if (s[1] >= s[0]) list.push(s);
      }
      list.sort((a, b) => a[0] - b[0]);
      const merged: Interval[] = [];
      for (const [a, b] of list) {
        const prev = merged[merged.length - 1];
        if (prev && a <= prev[1]) prev[1] = Math.max(prev[1], b);
        else merged.push([a, b]);
      }
      lastKey = key;
      last = merged;
      return merged;
    },
  };
}

/** Index of the last interval starting at or before `t`, or -1. */
function ivIndex(ivs: Interval[], t: number): number {
  let lo = 0;
  let hi = ivs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ivs[mid]![0] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

const quietAt = (ivs: Interval[], t: number) => {
  const i = ivIndex(ivs, t);
  return i >= 0 && t < ivs[i]![1];
};

/** End of the quiet interval containing `t` (which must be quiet). */
const quietEndAt = (ivs: Interval[], t: number) => ivs[ivIndex(ivs, t)]![1];

/** The latest moment in (lo, hi] when quiet hours ended, or null. */
function lastEndIn(ivs: Interval[], lo: number, hi: number): number | null {
  let a = 0;
  let b = ivs.length - 1;
  let found: number | null = null;
  while (a <= b) {
    const mid = (a + b) >> 1;
    if (ivs[mid]![1] <= hi) {
      found = ivs[mid]![1];
      a = mid + 1;
    } else b = mid - 1;
  }
  return found !== null && found > lo ? found : null;
}

// ---------------------------------------------------------------------------------------------
// Reference plan: what planBreaks should return, from the documented intent. The cadence runs
// every workMin from the anchor, or from the last end of quiet hours after setAt, unless a
// snooze is still to ring after that end. No reminder in quiet hours except that snooze's ring;
// after any quiet stretch the next reminder is exactly workMin after it ends.
//
// One case is open to two readings: a break that is still running (or was, since setAt) when
// quiet hours end. The anchor is the break's end, after the end of quiet hours. Counting from
// the end of quiet hours ('quiet') and counting from the end of the break ('break') are both
// reasonable, so either is accepted, but the plan must not switch between them as time passes
// (checked separately: re-planning later must book the same reminders).

type RefPlan = { start: number; dueAt: number; quietNow: boolean; reminders: number[] };

function referencePlan(
  now: number,
  s: Settings,
  timer: TimerState,
  max: number,
  ivs: Interval[],
  reading: 'quiet' | 'break' = 'quiet',
): RefPlan {
  const work = s.workMin * MINUTE;
  const ended = lastEndIn(ivs, -Infinity, now);
  const restarts =
    ended !== null &&
    ended > timer.setAt &&
    !(timer.snoozed && ended < timer.anchor + work) &&
    (reading === 'quiet' || ended >= timer.anchor);
  const start = restarts ? ended : timer.anchor;
  const dueAt = start + work;
  const quietNow = quietAt(ivs, now);
  const reminders: number[] = [];
  if (timer.paused) return { start, dueAt, quietNow, reminders };
  const ring = (t: number) => !!timer.snoozed && start === timer.anchor && t === dueAt;
  let c = dueAt > now ? dueAt : dueAt + (Math.floor((now - dueAt) / work) + 1) * work;
  let lo = reading === 'quiet' ? now : Math.max(now, timer.anchor);
  const horizon = now + HORIZON;
  for (let guard = 0; reminders.length < max && c <= horizon; guard++) {
    if (guard > 100_000) throw new Error('reference plan did not finish');
    if (!ring(c)) {
      if (quietAt(ivs, c)) {
        lo = quietEndAt(ivs, c);
        c = lo + work;
        continue;
      }
      const e = lastEndIn(ivs, lo, c);
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
  return { start, dueAt, quietNow, reminders };
}

// ---------------------------------------------------------------------------------------------
// Storage, as src/services/storage.ts parses the saved file (copied: that file imports Expo).

/** With `freeze`, the parsed file is deep-frozen first, so a loader that modified it would throw. */
function load(json: string, now: number, freeze = false): AppData {
  const parsed = JSON.parse(json) as Partial<AppData>;
  const raw = freeze ? deepFreeze(parsed) : parsed;
  const settings = settingsFrom(raw.settings);
  const days: Record<string, number> = {};
  if (raw.days && typeof raw.days === 'object') {
    for (const [k, v] of Object.entries(raw.days)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isInteger(v) && v > 0) days[k] = v;
    }
  }
  return {
    v: 1,
    onboarded: raw.onboarded === true,
    settings,
    timer: timerFrom(raw.timer, now),
    days,
    handled: Array.isArray(raw.handled) ? raw.handled.filter((h) => typeof h === 'string').slice(-30) : [],
    pond: pondFrom(raw.pond, days),
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}


// ---------------------------------------------------------------------------------------------
// Random inputs

const TIME_GRID_30 = Array.from({ length: 48 }, (_, i) => i * 30); // the Settings screen's choices
const SOUNDS = ['quack', 'voice', 'chime', 'drop', 'bell', 'beep', 'phone', 'none'] as const;
const VOICES = ['heart', 'bella', 'michael', 'george'] as const;
const WEARABLE = ITEMS.filter((i) => i.kind === 'wear').map((i) => i.id);
/** Zero-width space and joiner (written as char codes so no invisible character sits in the source). */
const ZWSP = String.fromCharCode(0x200b);
const ZWJ = String.fromCharCode(0x200d);
const NAMES = [
  'Quackers',
  '  Sir   Quacks  ',
  '',
  '   ',
  `${ZWSP}${ZWSP}`,
  '🦆🦆🦆',
  'A'.repeat(25),
  `Zero${ZWSP}width`,
  'Tab\tName\nNew line',
  'Ünïcödé dück',
  `👨${ZWJ}👩${ZWJ}👧 family`,
  `${'x'.repeat(19)} y`,
  `${'🦆'.repeat(19)} z`,
  'Pip',
];

/** A quiet-hours time: mostly the Settings screen's 30-minute grid, sometimes near the clock changes or off the grid. */
function randomTime(rand: Rand, grid: number, avoid: number): number {
  for (;;) {
    const m = rand.chance(0.3)
      ? Math.round(rand.int(30, 210) / grid) * grid // 00:30–03:30, where the clocks change
      : rand.int(0, 1440 / grid - 1) * grid;
    if (m !== avoid && m >= 0 && m < 1440) return m;
  }
}

function randomQuiet(rand: Rand, grid: number): QuietHours {
  const startMin = randomTime(rand, grid, -1);
  // Sometimes very long (23 h or more) or very short quiet hours.
  const r = rand.next();
  const endMin =
    r < 0.1
      ? (startMin + 1440 - grid * rand.int(1, 2)) % 1440
      : r < 0.2
        ? (startMin + grid * rand.int(1, 2)) % 1440
        : randomTime(rand, grid, startMin);
  return { enabled: rand.chance(0.8), startMin, endMin };
}

function randomSettings(rand: Rand, grid: number): Settings {
  const rule = rand.chance(0.35);
  return settingsFrom({
    rule202020: rule,
    workMin: rule ? RULE_WORK_MIN : rand.pick(WORK_CHOICES),
    breakSec: rule ? RULE_BREAK_SEC : rand.pick(BREAK_CHOICES),
    snoozeMin: rand.pick(SNOOZE_CHOICES),
    quiet: randomQuiet(rand, grid),
    startSound: rand.pick(SOUNDS),
    startVibrate: rand.chance(0.5),
    endSound: rand.pick(SOUNDS),
    endVibrate: rand.chance(0.5),
    voice: rand.pick(VOICES),
    haptics: rand.chance(0.5),
    trayTimer: rand.chance(0.5),
  });
}

/** An older user: some history, and a pond loaded the way storage loads it. */
function randomHistory(rand: Rand, t0: number): { days: Record<string, number>; pond: AppData['pond'] } {
  const days: Record<string, number> = {};
  const n = rand.chance(0.4) ? rand.int(KEEP_DAYS - 6, KEEP_DAYS) : rand.int(1, 60);
  const d0 = new Date(t0);
  for (let i = 1; i <= n; i++) {
    if (n < KEEP_DAYS - 6 && rand.chance(0.3)) continue;
    days[localDate(new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - i, 12).getTime())] = rand.int(1, 30);
  }
  if (rand.chance(0.3)) return { days, pond: pondFrom(undefined, days) }; // a save from before the pond
  const total = rand.int(0, 260);
  const saved = {
    total,
    lastAt: rand.chance(0.5) ? t0 - rand.int(0, 10 * MINUTE) : 0,
    name: rand.pick(NAMES),
    wearing: rand.pick([null, ...WEARABLE]),
    seen: rand.int(0, total),
  };
  return { days, pond: pondFrom(saved, days) };
}

// ---------------------------------------------------------------------------------------------
// One walk

type WalkConfig = {
  index: number;
  seed: number;
  zone: Zone;
  t0: number;
  /** The walk starts this close before a clock change, so it crosses it. */
  nearSwitch: boolean;
  steps: number;
  /** Reminders booked by planNotifications in the app: 60 on iOS, 150 on Android. */
  platformMax: number;
};

const WALKS = 250;

function walkConfig(index: number): WalkConfig {
  const seed = 0x5eed_0000 + index * 7919;
  const rand = makeRand(seed);
  const zone = ZONES[index % ZONES.length]!;
  const nearSwitch = zone.switches.length > 0 && rand.chance(0.45);
  const t0 = nearSwitch
    ? rand.pick(zone.switches) - rand.int(10 * MINUTE, 40 * HOUR) - rand.int(0, 59_999)
    : Date.UTC(2026, 0, 1) + rand.int(0, 330 * DAY) + rand.int(0, 59_999);
  return {
    index,
    seed,
    zone,
    t0,
    nearSwitch,
    steps: rand.int(200, 400),
    platformMax: rand.chance(0.5) ? MAX_REMINDERS : MAX_REMINDERS_ANDROID,
  };
}

type Violation = { kind: string; message: string };

type WalkResult = { steps: number; ms: number; slowestPlanMs: number; violations: Violation[] };

/** Everything known about the step being checked, for the reproduction in a failure message. */
type StepInfo = {
  cfg: WalkConfig;
  step: number;
  action: string;
  before: AppData;
  beforeNow: number;
  data: AppData;
  now: number;
  max: number;
};

function brief(d: AppData): string {
  const keys = Object.keys(d.days).sort();
  const days =
    keys.length <= 4
      ? JSON.stringify(d.days)
      : `{${keys
          .slice(-3)
          .map((k) => `"${k}":${d.days[k]}`)
          .join(',')}, … ${keys.length - 3} older days}`;
  return JSON.stringify({ settings: d.settings, timer: d.timer, pond: d.pond }) + ` days ${days}`;
}

function describeTimer(t: TimerState): string {
  const parts = [`anchor ${zoned(t.anchor)}`, `setAt ${zoned(t.setAt)}`, `breakEndsAt ${t.breakEndsAt === null ? 'null' : zoned(t.breakEndsAt)}`];
  if (t.paused) parts.push('paused');
  if (t.snoozed) parts.push('snoozed');
  return parts.join(', ');
}

function repro(info: StepInfo, kind: string, detail: string, plan?: BreakPlan, ref?: RefPlan): string {
  const { cfg, step, action, before, beforeNow, data, now, max } = info;
  const s = data.settings;
  const lines = [
    `INVARIANT: ${kind}`,
    `  ${detail}`,
    `walk #${cfg.index} seed ${cfg.seed} (${cfg.zone.name}), step ${step}: ${action}`,
    `  now ${zoned(now)} = ${now}${beforeNow !== now ? ` (was ${zoned(beforeNow)} = ${beforeNow})` : ''}`,
    `  settings: every ${s.workMin} min, break ${s.breakSec} s, snooze ${s.snoozeMin} min, quiet ${fmtQuiet(s.quiet)}`,
    `  timer before: ${describeTimer(before.timer)}`,
    `  timer after:  ${describeTimer(data.timer)}`,
  ];
  if (plan) {
    lines.push(
      `  planBreaks(${now}, settings, timer, { max: ${max} }): dueAt ${zoned(plan.dueAt)}, overdue ${plan.overdue}, ` +
        `quietNow ${plan.quietNow}, breakActive ${plan.breakActive}`,
      `    reminders ${fmtTimes(plan.reminders)}`,
    );
  }
  if (ref) lines.push(`  expected: dueAt ${zoned(ref.dueAt)}, quietNow ${ref.quietNow}, reminders ${fmtTimes(ref.reminders)}`);
  lines.push(`  state before: ${brief(before)}`, `  state after:  ${brief(data)}`);
  return lines.join('\n');
}

const firstDiff = (a: readonly number[], b: readonly number[]) => {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return -1;
};

const show = (t: number | undefined) => (t === undefined ? 'nothing' : zoned(t));

/** How often the walks reached states worth reaching, printed at the end so gaps in coverage show. */
const coverage = new Map<string, number>();
const tally = (key: string) => coverage.set(key, (coverage.get(key) ?? 0) + 1);

/** Actions that start, finish or reset the break cycle: each first counts a break whose time is up. */
const CYCLE_ACTIONS = new Set(['startBreak', 'skipBreak', 'snooze', 'stopReminders', 'resumeReminders', 'updateSettings', 'finishBreakIfDone']);

function runWalk(cfg: WalkConfig): WalkResult {
  setZone(cfg.zone);
  const started = performance.now();
  const rand = makeRand(cfg.seed ^ 0x9e3779b9);
  const quiet = quietModel();
  const violations: Violation[] = [];
  const seenKinds = new Set<string>();
  let slowestPlanMs = 0;

  // Quiet hours on the Settings screen's 30-minute grid, or (as saved by hand or an older
  // version) on a 15- or 5-minute grid.
  const grid = rand.pick([30, 30, 30, 30, 15, 5]);
  let now = cfg.t0;
  let data: AppData = { ...defaultData(now), settings: randomSettings(rand, grid) };
  if (rand.chance(0.45)) data = { ...data, ...randomHistory(rand, now) };
  data = finishOnboarding(data, now);
  const initialTotal = data.pond.total;
  let countedEver = 0; // breaks added to `days` since the walk began

  let info: StepInfo = { cfg, step: 0, action: 'finishOnboarding', before: data, beforeNow: now, data, now, max: cfg.platformMax };
  const violate = (kind: string, detail: string, plan?: BreakPlan, ref?: RefPlan) => {
    if (seenKinds.has(kind)) return;
    seenKinds.add(kind);
    violations.push({ kind, message: repro(info, kind, detail, plan, ref) });
  };
  const check = (ok: boolean, kind: string, detail: () => string, plan?: BreakPlan, ref?: RefPlan) => {
    if (!ok) violate(kind, detail(), plan, ref);
  };

  let prevPlan: StepContext['prevPlan'] = null;

  for (let step = 1; step <= cfg.steps; step++) {
    const before = deepFreeze(data);
    const beforeNow = now;
    const s = before.settings;
    const lastPlan = prevPlan?.plan;
    let action = '';
    let next: AppData = before;

    try {
      const r = rand.next();
      if (r < 0.42) {
        // Time passes.
        const ivs = quiet.intervals(s.quiet, now);
        const k = rand.next();
        let to: number;
        if (k < 0.25) to = now + rand.int(1, 150) * SEC + rand.int(0, 999);
        else if (k < 0.6) to = now + rand.int(1, 90) * MINUTE + rand.int(0, 59_999);
        else if (k < 0.8) to = now + rand.int(1, 12) * HOUR + rand.int(0, HOUR);
        else if (k < 0.85) to = now + rand.int(1, 3) * DAY + rand.int(0, DAY);
        else {
          // Exactly onto (or 1 ms either side of) a moment that matters.
          const targets: number[] = [];
          if (lastPlan && lastPlan.reminders.length) targets.push(lastPlan.reminders[0]!, lastPlan.dueAt);
          if (before.timer.breakEndsAt !== null) targets.push(before.timer.breakEndsAt);
          const i = ivIndex(ivs, now);
          const nextIv = ivs[i >= 0 && now < ivs[i]![1] ? i : i + 1];
          if (nextIv) targets.push(now < nextIv[0] ? nextIv[0] : nextIv[1]);
          for (const sw of cfg.zone.switches) if (sw > now) targets.push(sw);
          const future = targets.filter((t) => t > now);
          to = future.length ? rand.pick(future) + rand.pick([0, 0, -1, 1]) : now + MINUTE;
          if (to <= now) to = now + 1;
        }
        action = `time passes to ${zoned(to)} (+${Math.round((to - now) / SEC)} s)`;
        now = to;
      } else if (r < 0.52) {
        action = 'startBreak';
        next = startBreak(before, now);
      } else if (r < 0.57) {
        action = 'skipBreak';
        next = skipBreak(before, now);
      } else if (r < 0.63) {
        action = 'snooze';
        next = snooze(before, now);
      } else if (r < 0.66) {
        action = 'stopReminders';
        next = stopReminders(before, now);
      } else if (r < 0.7) {
        action = 'resumeReminders';
        next = resumeReminders(before, now);
      } else if (r < 0.8) {
        // A settings change, as the Settings screen makes it.
        const q = s.quiet;
        const kind = rand.pick(['work', 'break', 'snooze', 'quietToggle', 'quietStart', 'quietEnd', 'rule', 'sound'] as const);
        let patch: Partial<Settings>;
        if ((kind === 'work' || kind === 'break') && s.rule202020) patch = { rule202020: false };
        else if (kind === 'work') patch = { workMin: rand.pick(WORK_CHOICES) };
        else if (kind === 'break') patch = { breakSec: rand.pick(BREAK_CHOICES) };
        else if (kind === 'snooze') patch = { snoozeMin: rand.pick(SNOOZE_CHOICES) };
        else if (kind === 'quietToggle' || !q.enabled) patch = { quiet: { ...q, enabled: !q.enabled } };
        else if (kind === 'quietStart') patch = { quiet: { ...q, startMin: randomTime(rand, grid, q.endMin) } };
        else if (kind === 'quietEnd') patch = { quiet: { ...q, endMin: randomTime(rand, grid, q.startMin) } };
        else if (kind === 'rule')
          patch = s.rule202020 ? { rule202020: false } : { rule202020: true, workMin: RULE_WORK_MIN, breakSec: RULE_BREAK_SEC };
        else
          patch = rand.pick([
            { startSound: rand.pick(SOUNDS) },
            { endSound: rand.pick(SOUNDS) },
            { voice: rand.pick(VOICES) },
            { startVibrate: rand.chance(0.5) },
            { haptics: rand.chance(0.5), trayTimer: rand.chance(0.5) },
          ]);
        action = `updateSettings(${JSON.stringify(patch)})`;
        next = updateSettings(before, deepFreeze(patch), now);
      } else if (r < 0.83) {
        const id = rand.pick<ItemId | null>([...ITEMS.map((i) => i.id), null, null, 'crown' as ItemId]);
        action = `wearItem(${JSON.stringify(id)})`;
        next = wearItem(before, id);
      } else if (r < 0.85) {
        const name = rand.chance(0.7) ? rand.pick(NAMES) : Array.from({ length: rand.int(0, 30) }, () => rand.pick([...'ab Zü🦆\t', ZWSP])).join('');
        action = `renameDuck(${JSON.stringify(name)})`;
        next = renameDuck(before, name);
      } else if (r < 0.87) {
        action = 'markPondSeen';
        next = markPondSeen(before);
      } else if (r < 0.89) {
        action = 'rememberHandled';
        next = rememberHandled(before, `response-${step}`);
      } else if (r < 0.92) {
        action = 'finishBreakIfDone';
        next = finishBreakIfDone(before, now);
      } else if (r < 0.985) {
        action = 'storage round-trip (save, then load)';
        next = load(JSON.stringify(before), now, true);
      } else {
        const back = rand.pick([rand.int(1, 59) * MINUTE, rand.int(1, 23) * HOUR, DAY]) + rand.int(0, 59_999);
        now -= back;
        action = `clock goes back ${Math.round(back / MINUTE)} min to ${zoned(now)}, then load`;
        next = load(JSON.stringify(before), now, true);
      }
    } catch (e) {
      info = { cfg, step, action, before, beforeNow, data: before, now, max: cfg.platformMax };
      violate('nothing ever throws', `${action} threw ${(e as Error)?.stack ?? String(e)}`);
      break;
    }

    data = next;
    const m = rand.chance(0.12) ? cfg.platformMax : rand.chance(0.02) ? rand.pick([0, MAX_REMINDERS_ANDROID]) : rand.int(1, 8);
    info = { cfg, step, action, before, beforeNow, data, now, max: m };
    try {
      const onPlanTime = (ms: number) => (slowestPlanMs = Math.max(slowestPlanMs, ms));
      const plan = checkStep(info, { prevPlan, initialTotal, countedEver, quiet, check, onPlanTime });
      prevPlan = { now, max: m, plan };
      countedEver += addedBreaks(before.days, data.days);
    } catch (e) {
      violate('nothing ever throws', `checking after ${action} threw ${(e as Error)?.stack ?? String(e)}`);
      break;
    }
  }
  return { steps: cfg.steps, ms: performance.now() - started, slowestPlanMs, violations };
}

/** Breaks added to `days` between two states. */
function addedBreaks(prev: Record<string, number>, next: Record<string, number>): number {
  if (prev === next) return 0;
  let added = 0;
  for (const [k, v] of Object.entries(next)) added += Math.max(0, v - (prev[k] ?? 0));
  return added;
}

type Checker = (ok: boolean, kind: string, detail: () => string, plan?: BreakPlan, ref?: RefPlan) => void;

type StepContext = {
  prevPlan: { now: number; max: number; plan: BreakPlan } | null;
  initialTotal: number;
  countedEver: number;
  quiet: QuietModel;
  check: Checker;
  onPlanTime: (ms: number) => void;
};

/**
 * Every invariant of planBreaks for one moment, against the reference model. Returns the
 * reference plan (the 'quiet' or 'break' reading, whichever the plan matches).
 */
function checkSchedule(now: number, s: Settings, t: TimerState, max: number, ivs: Interval[], plan: BreakPlan, check: Checker): RefPlan {
  const work = s.workMin * MINUTE;
  let ref = referencePlan(now, s, t, max, ivs);
  if (plan.dueAt !== ref.dueAt || firstDiff(plan.reminders, ref.reminders) !== -1) {
    const alt = referencePlan(now, s, t, max, ivs, 'break');
    if (plan.dueAt === alt.dueAt && firstDiff(plan.reminders, alt.reminders) === -1) ref = alt;
  }
  const rs = plan.reminders;

  check(rs.length <= max, 'at most max reminders', () => `${rs.length} for max ${max}`, plan);
  check(rs.every((r, i) => r > now && (i === 0 || r > rs[i - 1]!)), 'reminders are after now and strictly increasing', () => fmtTimes(rs, 10), plan);
  check(rs.every((r) => r <= now + HORIZON), 'no reminder beyond the 8-day horizon', () => show(rs.at(-1)), plan);
  if (t.paused) check(rs.length === 0 && !plan.overdue, 'nothing planned and never overdue while stopped', () => `${rs.length} reminders`, plan);
  if (plan.overdue) check(now >= plan.dueAt && !plan.breakActive, 'overdue only once due and with no break running', () => '', plan);
  check(plan.breakActive === (t.breakEndsAt !== null && t.breakEndsAt > now), 'breakActive until breakEndsAt', () => describeTimer(t), plan);

  // The snoozed ring is the one reminder allowed in quiet hours, unless quiet hours have since restarted the cadence.
  const ringAllowed = (r: number) => !!t.snoozed && r === plan.dueAt && plan.dueAt - work === t.anchor;
  const inQuiet = rs.filter((r) => quietAt(ivs, r) && !ringAllowed(r));
  check(inQuiet.length === 0, 'no reminder inside quiet hours (except a snoozed ring)', () => `in quiet hours ${fmtQuiet(s.quiet)}: ${fmtTimes(inQuiet)}`, plan, ref);

  for (let i = 1; i < rs.length; i++) {
    const a = rs[i - 1]!;
    const b = rs[i]!;
    const end = lastEndIn(ivs, a, b);
    if (b - a < work) {
      check(false, 'consecutive reminders are at least workMin apart', () => `#${i - 1} ${zoned(a)} → #${i} ${zoned(b)}`, plan, ref);
      break;
    }
    if (end === null && b - a !== work) {
      check(false, 'reminders are exactly workMin apart when no quiet hours end between them', () => `#${i - 1} ${zoned(a)} → #${i} ${zoned(b)}: ${(b - a) / MINUTE} min`, plan, ref);
      break;
    }
    if (end !== null && b !== end + work) {
      check(
        false,
        'the first reminder after quiet hours end is exactly workMin after the end',
        () => `#${i - 1} ${zoned(a)}, quiet hours end ${zoned(end)}, then #${i} ${zoned(b)} (expected ${zoned(end + work)})`,
        plan,
        ref,
      );
      break;
    }
  }

  check(plan.quietNow === ref.quietNow, 'quietNow matches the wall clock', () => `quietNow ${plan.quietNow}, quiet hours ${fmtQuiet(s.quiet)}`, plan, ref);
  check(
    plan.dueAt === ref.dueAt,
    'dueAt counts from the anchor, or from the last end of quiet hours since setAt (a pending snooze excepted)',
    () => {
      const ended = lastEndIn(ivs, -Infinity, now);
      return `dueAt ${zoned(plan.dueAt)}, expected ${zoned(ref.dueAt)}; quiet hours last ended ${show(ended ?? undefined)}`;
    },
    plan,
    ref,
  );
  const expectOverdue =
    !t.paused && !plan.breakActive && now >= plan.dueAt && (!plan.quietNow || (!!t.snoozed && plan.dueAt - work === t.anchor));
  check(plan.overdue === expectOverdue, 'overdue: due, no break running, and not in quiet hours (unless a snoozed ring)', () => `overdue ${plan.overdue}`, plan, ref);
  const at = firstDiff(rs, ref.reminders);
  check(
    at === -1,
    'reminders match the reference cadence',
    () => `reminder #${at}: ${show(rs[at])}, expected ${show(ref.reminders[at])} (previous ${show(rs[at - 1])})`,
    plan,
    ref,
  );

  return ref;
}

/** Re-planning later with nothing changed books the same reminders (the app re-plans whenever it wakes). */
function checkReplan(
  prev: { now: number; max: number; plan: BreakPlan },
  cur: { now: number; max: number; plan: BreakPlan },
  check: Checker,
  ref?: RefPlan,
): void {
  const { now, max, plan } = cur;
  const rs = plan.reminders;
  if (prev.max === 0 || max === 0) return;
  // Compare only the stretch both plans cover (each stops at its max or at its horizon).
  const cutPrev = prev.plan.reminders.length >= prev.max ? prev.plan.reminders.at(-1)! : prev.now + HORIZON;
  const cutNow = rs.length >= max ? rs.at(-1)! : now + HORIZON;
  const cut = Math.min(cutPrev, cutNow);
  const was = prev.plan.reminders.filter((r) => r > now && r <= cut);
  const is = rs.filter((r) => r <= cut);
  const k = firstDiff(is, was);
  if (is.length) tally('re-plans compared');
  check(
    k === -1,
    're-planning later with nothing changed books the same reminders',
    () =>
      `planned at ${zoned(prev.now)}: ${fmtTimes(was.slice(k), 3)} (dueAt ${zoned(prev.plan.dueAt)}); ` +
      `planned again at ${zoned(now)}: ${fmtTimes(is.slice(k), 3)} (dueAt ${zoned(plan.dueAt)})`,
    plan,
    ref,
  );
}

function checkStep(info: StepInfo, ctx: StepContext): BreakPlan {
  const { before, data: d, now, max, action } = info;
  const { check } = ctx;
  const s = d.settings;
  const t = d.timer;
  const work = s.workMin * MINUTE;
  const ivs = ctx.quiet.intervals(s.quiet, now);
  const actionName = action.split('(')[0]!;

  // --- The state is valid -------------------------------------------------------------------
  check(
    WORK_CHOICES.includes(s.workMin) && BREAK_CHOICES.includes(s.breakSec) && SNOOZE_CHOICES.includes(s.snoozeMin),
    'settings are valid choices',
    () => `workMin ${s.workMin}, breakSec ${s.breakSec}, snoozeMin ${s.snoozeMin}`,
  );
  check(!s.rule202020 || (s.workMin === RULE_WORK_MIN && s.breakSec === RULE_BREAK_SEC), 'the 20-20-20 rule means 20 min and 20 s', () => JSON.stringify(s));
  check(s.quiet.startMin !== s.quiet.endMin, 'quiet hours start and end differ', () => fmtQuiet(s.quiet));
  const finite = (v: number) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  check(
    finite(t.anchor) && finite(t.setAt) && (t.breakEndsAt === null || finite(t.breakEndsAt)),
    'timer times are positive finite numbers',
    () => JSON.stringify(t),
  );
  check(t.setAt <= now, 'the timer was never set in the future', () => `setAt ${zoned(t.setAt)}`);
  check(t.paused === undefined || t.paused === true, 'paused is true or absent', () => JSON.stringify(t));
  check(t.snoozed === undefined || t.snoozed === true, 'snoozed is true or absent', () => JSON.stringify(t));
  check(d.handled.length <= 30, 'at most 30 handled keys', () => `${d.handled.length} keys`);
  check(d.onboarded === true, 'stays onboarded', () => String(d.onboarded));

  // --- Breaks and the pond --------------------------------------------------------------------
  const p = d.pond;
  const daysChanged = before.days !== d.days;
  const keys = daysChanged ? Object.keys(d.days) : [];
  if (daysChanged) {
    check(keys.length <= KEEP_DAYS, `at most ${KEEP_DAYS} days kept`, () => `${keys.length} days`);
    check(
      keys.every((k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && Number.isInteger(d.days[k]) && d.days[k]! > 0),
      'day keys are YYYY-MM-DD with positive whole counts',
      () => JSON.stringify(d.days),
    );
    for (const [k, v] of Object.entries(before.days)) {
      if (k in d.days) check(d.days[k]! >= v, 'day counts never decrease', () => `${k}: ${v} → ${d.days[k]}`);
      else {
        check(
          keys.length === KEEP_DAYS && keys.every((x) => x > k),
          'only days beyond the newest 400 are dropped',
          () => `${k} (count ${v}) dropped; ${keys.length} days kept, oldest ${[...keys].sort()[0]}`,
        );
      }
    }
  }
  const added = addedBreaks(before.days, d.days);
  const grew = p.total - before.pond.total;
  check(grew >= 0, 'pond.total never decreases', () => `${before.pond.total} → ${p.total}`);
  check(grew <= added, 'the pond grows only with a break counted today', () => `pond +${grew}, days +${added}`);
  check(
    p.total <= ctx.initialTotal + ctx.countedEver + added,
    'pond.total never exceeds the breaks ever counted plus its starting value',
    () => `total ${p.total}, started at ${ctx.initialTotal}, ${ctx.countedEver + added} breaks counted since`,
  );
  check(Number.isInteger(p.total) && p.total >= 0, 'pond.total is a whole number', () => String(p.total));
  check(Number.isInteger(p.seen) && p.seen >= 0 && p.seen <= p.total, 'pond.seen ≤ pond.total', () => `seen ${p.seen}, total ${p.total}`);
  check(Number.isFinite(p.lastAt) && p.lastAt >= 0, 'pond.lastAt is a time or 0', () => String(p.lastAt));
  const worn = p.wearing === null ? null : ITEMS.find((i) => i.id === p.wearing);
  check(
    p.wearing === null || (worn !== undefined && worn.kind === 'wear' && p.total >= worn.at),
    'the duck wears nothing or an unlocked hat or scarf',
    () => `wearing ${p.wearing} with ${p.total} breaks`,
  );
  const nameLength = Array.from(p.name).length;
  check(
    typeof p.name === 'string' && nameLength >= 1 && nameLength <= MAX_NAME_LENGTH && cleanName(p.name) === p.name,
    `the name is 1–${MAX_NAME_LENGTH} characters, clean and never empty`,
    () => JSON.stringify(p.name),
  );

  // Every break-cycle action first counts a break whose time is up, exactly once.
  const endedAt = before.timer.breakEndsAt;
  const due = CYCLE_ACTIONS.has(actionName) && endedAt !== null && endedAt <= now;
  if (due) {
    const key = localDate(endedAt);
    const trimmed = !(key in d.days) && Object.keys(d.days).length === KEEP_DAYS;
    check(
      added === 1 && (trimmed || d.days[key] === (before.days[key] ?? 0) + 1),
      'a break whose time is up is counted once, on the day it ended',
      () => `break ended ${zoned(endedAt)}: days +${added}, ${key} ${before.days[key] ?? 0} → ${d.days[key]}`,
    );
    const tooSoon = before.pond.lastAt > 0 && Math.abs(endedAt - before.pond.lastAt) < MIN_GAP_MS;
    check(
      grew === (tooSoon ? 0 : 1) && (tooSoon || p.lastAt === endedAt),
      'the pond grows for a finished break unless it ended within 5 min of the last counted one',
      () => `ended ${zoned(endedAt)}, last counted ${before.pond.lastAt ? zoned(before.pond.lastAt) : 'never'}: pond +${grew}`,
    );
  } else if (!action.startsWith('clock goes back')) {
    check(added === 0 && grew === 0, 'nothing is counted without a finished break', () => `days +${added}, pond +${grew}`);
  }

  // --- Transitions ----------------------------------------------------------------------------
  const done = finishBreakIfDone(d, now);
  check(finishBreakIfDone(done, now) === done, 'finishBreakIfDone is idempotent (same object the second time)', () => describeTimer(done.timer));
  if (t.breakEndsAt === null || t.breakEndsAt > now) check(done === d, 'finishBreakIfDone changes nothing with no finished break', () => describeTimer(t));

  // --- Storage round-trip ---------------------------------------------------------------------
  // Compared as JSON (the file can't hold undefined keys); the string compare is a fast path,
  // and a mismatch is confirmed key-order-independently.
  const json = JSON.stringify(d);
  const loaded = load(json, now);
  if (JSON.stringify(loaded) !== json) {
    const saved = JSON.parse(json) as AppData;
    let same = true;
    try {
      assert.deepStrictEqual(loaded, saved);
    } catch {
      same = false;
    }
    const diff = (['settings', 'timer', 'days', 'handled', 'pond'] as const)
      .filter((k) => JSON.stringify(loaded[k]) !== JSON.stringify(saved[k]))
      .map((k) => `${k}: saved ${JSON.stringify(saved[k])}, loaded ${JSON.stringify(loaded[k])}`)
      .join('; ');
    check(same, 'a storage round-trip gives back the same state', () => diff || 'differs');
  }

  // --- planBreaks -----------------------------------------------------------------------------
  const timePlan = () => {
    const started = performance.now();
    planBreaks(now, s, t, { max });
    return performance.now() - started;
  };
  const startedPlan = performance.now();
  const plan = planBreaks(now, s, t, { max });
  let planMs = performance.now() - startedPlan;
  // A garbage collection or a busy machine (test files run in parallel) can stall one call:
  // time a slow plan again, and judge the fastest.
  if (planMs >= 50) planMs = Math.min(planMs, timePlan(), timePlan());
  if (max >= MAX_REMINDERS_ANDROID) {
    ctx.onPlanTime(planMs);
    check(planMs < 50, 'planBreaks with max 150 finishes fast (< 50 ms)', () => `${planMs.toFixed(1)} ms`, plan);
  }
  const ref = checkSchedule(now, s, t, max, ivs, plan, check);
  const rs = plan.reminders;
  if (ctx.prevPlan && before === d) checkReplan(ctx.prevPlan, { now, max, plan }, check, ref);

  // --- planNotifications ----------------------------------------------------------------------
  const notes = planNotifications(d, now, max);
  const kindOf = (k: PlannedNotification['kind']) => notes.filter((n) => n.kind === k);
  const dues = kindOf('due');
  const overs = kindOf('over');
  const outs = kindOf('out');
  check(new Set(notes.map((n) => n.id)).size === notes.length, 'notification ids are unique', () => notes.map((n) => n.id).join(' '), plan);
  check(notes.every((n) => n.at > now), 'every notification is after now', () => notes.filter((n) => n.at <= now).map((n) => `${n.kind} ${zoned(n.at)}`).join(', '), plan);
  check(dues.length + overs.length + outs.length === notes.length, 'notifications are due, over or out', () => notes.map((n) => n.kind).join(','));
  check(firstDiff(dues.map((n) => n.at), rs) === -1, "'due' times are planBreaks' reminders", () => `due ${fmtTimes(dues.map((n) => n.at))}`, plan);
  check(
    overs.length === (plan.breakActive ? 1 : 0) && (overs.length === 0 || overs[0]!.at === t.breakEndsAt),
    "one 'over' at breakEndsAt while a break runs, none otherwise",
    () => `over ${fmtTimes(overs.map((n) => n.at))}, ${describeTimer(t)}`,
    plan,
  );
  check(outs.length === (dues.length > 0 ? 1 : 0), "one 'out' (last call) when reminders are booked, none otherwise", () => `${outs.length} out, ${dues.length} due`, plan);
  if (outs.length === 1 && dues.length > 0) {
    const last = dues.at(-1)!.at;
    const want = quietAt(ivs, last + work) ? quietEndAt(ivs, last + work) : last + work;
    check(
      outs[0]!.at === want,
      "the last call is one interval after the last reminder, moved to the end of quiet hours",
      () => `out ${zoned(outs[0]!.at)}, last reminder ${zoned(last)}, expected ${zoned(want)}`,
      plan,
    );
  }
  check(planNotifications({ ...d, onboarded: false }, now, max).length === 0, 'nothing is booked before onboarding', () => '', plan);

  // --- Coverage -------------------------------------------------------------------------------
  if (due) tally('breaks counted');
  if (grew > 0) tally('pond grew');
  if (daysChanged && Object.keys(before.days).some((k) => !(k in d.days))) tally('old days trimmed');
  if (rs.some((r) => quietAt(ivs, r))) tally('snoozed rings in quiet hours');
  if (rs.some((r, i) => i > 0 && lastEndIn(ivs, rs[i - 1]!, r) !== null)) tally('plans across quiet hours');
  if (plan.overdue) tally('overdue');
  if (plan.breakActive) tally('break running');
  if (t.paused) tally('stopped');
  if (p.wearing) tally('wearing something');
  if (max >= MAX_REMINDERS_ANDROID) tally('plans of 150');
  if (info.cfg.zone.switches.some((sw) => Math.abs(sw - now) < 2 * DAY)) tally('steps within 2 days of a clock change');
  if (action.startsWith('clock goes back') && t.setAt === now) tally('timers reset by the clock going back');
  tally(`action: ${actionName.startsWith('time passes') ? 'time passes' : actionName.startsWith('clock goes back') ? 'clock goes back' : actionName.startsWith('storage') ? 'storage round-trip' : actionName}`);

  // --- What each action promises --------------------------------------------------------------
  const wasRunning = before.timer.breakEndsAt !== null && before.timer.breakEndsAt > now;
  if (actionName === 'startBreak') {
    if (wasRunning) check(d === before, 'startBreak during a break changes nothing', () => '');
    else {
      check(
        t.breakEndsAt === now + s.breakSec * SEC && plan.breakActive && !plan.overdue && !!t.paused === !!before.timer.paused,
        'startBreak runs a break of breakSec, keeping reminders stopped or not',
        () => describeTimer(t),
        plan,
      );
    }
  }
  if (actionName === 'skipBreak' || actionName === 'resumeReminders' || actionName === 'finishOnboarding') {
    check(!plan.overdue && plan.dueAt > now, `nothing is overdue right after ${actionName}`, () => '', plan, ref);
  }
  if (actionName === 'skipBreak') check(t.breakEndsAt === null && !!t.paused === !!before.timer.paused, 'skipBreak ends any break and keeps stopped reminders stopped', () => describeTimer(t), plan);
  if (actionName === 'snooze') {
    const ring = now + s.snoozeMin * MINUTE;
    check(
      plan.dueAt === ring && !plan.overdue && (max === 0 || rs[0] === ring),
      'a snooze rings snoozeMin from now, even in quiet hours',
      () => `ring ${show(rs[0])}, expected ${zoned(ring)}`,
      plan,
      ref,
    );
  }
  if (actionName === 'stopReminders') check(!!t.paused && rs.length === 0 && t.breakEndsAt === null, 'stopping books nothing', () => describeTimer(t), plan);
  if (actionName === 'resumeReminders') check(!t.paused, 'resuming clears the stop', () => describeTimer(t), plan);
  if (actionName === 'updateSettings' && s.workMin !== before.settings.workMin) {
    check(!plan.overdue && plan.dueAt > now, 'a new reminder interval never makes a break overdue at once', () => '', plan, ref);
  }
  if (action.startsWith('clock goes back')) {
    // The longest choices, not the current settings: a break or snooze keeps the length it started with.
    const longestBreak = Math.max(...BREAK_CHOICES) * SEC;
    const ahead = Math.max(longestBreak, (Math.max(...SNOOZE_CHOICES) - Math.min(...WORK_CHOICES)) * MINUTE) + 5 * SEC;
    check(
      (t.breakEndsAt === null || t.breakEndsAt <= now + longestBreak + 5 * SEC) && t.anchor <= now + ahead && t.setAt <= now,
      'after the clock goes back, nothing loaded is further ahead than the longest break or snooze',
      () => describeTimer(t),
      plan,
    );
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------
// The walks: one test per seed, spread across the zones.

describe('fuzz: random walks through the app state', () => {
  let totalSteps = 0;
  let totalMs = 0;
  for (let i = 0; i < WALKS; i++) {
    const cfg = walkConfig(i);
    setZone(cfg.zone);
    const name =
      `walk #${i} (seed ${cfg.seed}) ${cfg.zone.name} from ${zoned(cfg.t0)}${cfg.nearSwitch ? ', across a clock change' : ''}, ` +
      `${cfg.steps} steps, max ${cfg.platformMax}`;
    it(name, () => {
      const res = runWalk(cfg);
      totalSteps += res.steps;
      totalMs += res.ms;
      if (i === WALKS - 1) {
        const tallies = [...coverage].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`);
        console.log(`fuzz: ${totalSteps} steps in ${(totalMs / 1000).toFixed(1)} s. Reached: ${tallies.join(', ')}`);
      }
      if (res.violations.length) {
        const others = res.violations.slice(1).map((v) => `  also: ${v.kind}`);
        assert.fail([res.violations[0]!.message, ...others].join('\n'));
      }
      assert.ok(res.ms < 1000, `walk took ${res.ms.toFixed(0)} ms (slowest 150-reminder plan ${res.slowestPlanMs.toFixed(1)} ms)`);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Clock changes × quiet hours, swept exhaustively: the random walks rarely land on a quiet
// setting that starts or ends inside the hour the clocks skip or repeat. Every quiet setting on
// the Settings screen's 30-minute grid with an edge between 00:00 and 04:00, planned every
// 43 minutes from 5 hours before to 6 hours after each clock change, from a timer set a day
// earlier, checked against the reference model, and re-planned at each step.

describe('fuzz: clock changes × quiet hours (exhaustive sweep)', () => {
  for (const z of ZONES.filter((zone) => zone.switches.length > 0)) {
    it(`${z.name}: every 30-minute quiet setting with an edge in 00:00–04:00, around both clock changes`, () => {
      setZone(z);
      const model = quietModel();
      const failures: string[] = [];
      const seen = new Set<string>();
      let plans = 0;
      for (const sw of z.switches) {
        for (const startMin of TIME_GRID_30) {
          for (const endMin of TIME_GRID_30) {
            if (startMin === endMin || (startMin > 240 && endMin > 240)) continue;
            const q: QuietHours = { enabled: true, startMin, endMin };
            const workMin = [20, 45, 90][(startMin + endMin) % 3]!;
            const s: Settings = { ...DEFAULT_SETTINGS, rule202020: false, workMin, quiet: q };
            const t0 = sw - 30 * HOUR + 7 * SEC;
            const timer: TimerState = { anchor: t0, setAt: t0, breakEndsAt: null };
            let prev: { now: number; max: number; plan: BreakPlan } | null = null;
            for (let now = sw - 5 * HOUR; now <= sw + 6 * HOUR; now += 43 * MINUTE) {
              const plan = planBreaks(now, s, timer, { max: 6 });
              plans++;
              const check: Checker = (ok, kind, detail, p, ref) => {
                if (ok || seen.has(kind)) return;
                seen.add(kind);
                failures.push(
                  [
                    `INVARIANT: ${kind}`,
                    `  ${detail()}`,
                    `  ${z.name}, quiet ${fmtQuiet(q)}, every ${workMin} min, timer set ${zoned(t0)}, now ${zoned(now)} = ${now}`,
                    p ? `  planBreaks: dueAt ${zoned(p.dueAt)}, quietNow ${p.quietNow}, reminders ${fmtTimes(p.reminders)}` : '',
                    ref ? `  expected: dueAt ${zoned(ref.dueAt)}, quietNow ${ref.quietNow}, reminders ${fmtTimes(ref.reminders)}` : '',
                  ]
                    .filter(Boolean)
                    .join('\n'),
                );
              };
              const ref = checkSchedule(now, s, timer, 6, model.intervals(q, now), plan, check);
              if (prev) checkReplan(prev, { now, max: 6, plan }, check, ref);
              prev = { now, max: 6, plan };
            }
          }
        }
      }
      assert.ok(plans > 10_000, `${plans} plans`);
      if (failures.length) assert.fail(failures.join('\n'));
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Cases found by the walks and the sweep, shrunk by hand to minimal deterministic regression tests.

describe('fuzz: found cases, shrunk to minimal regression tests', () => {
  const LONDON = zoneNamed('Europe/London');
  const NEW_YORK = zoneNamed('America/New_York');
  /** London wall time on 10 June 2026 (far from any clock change), plus `dd` days. */
  const jun = (h: number, mi = 0, dd = 0, s = 0) => new Date(2026, 5, 10 + dd, h, mi, s).getTime();
  const onboarded = (settings: Settings, t: number) => finishOnboarding({ ...defaultData(t), settings }, t);
  const custom = (patch: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, rule202020: false, ...patch });

  it('a running break survives a reload after the break length is shortened, or the 20-20-20 rule is turned on', () => {
    setZone(LONDON);
    // Every 30 min with 2-minute breaks; a break starts at 10:00 and runs to 10:02.
    const running = startBreak(onboarded(custom({ workMin: 30, breakSec: 120 }), jun(9)), jun(10));
    for (const patch of [{ breakSec: 20 }, { rule202020: true, workMin: RULE_WORK_MIN, breakSec: RULE_BREAK_SEC }]) {
      const d = updateSettings(running, patch, jun(10, 0, 0, 30));
      // Shortening the break mid-break leaves breakEndsAt (10:02) more than one *new* break length
      // ahead. timerFrom judges a saved timer by the longest break and snooze choices, not the
      // current settings, so the next load (restart, background task, back to the foreground)
      // doesn't mistake it for a clock that went back: the break keeps the length it started with.
      const loaded = load(JSON.stringify(d), jun(10, 0, 0, 31));
      assert.deepEqual(loaded.timer, d.timer, `after updateSettings(${JSON.stringify(patch)}) during a 2-minute break`);
    }
  });

  it('a pending snooze survives a reload after the snooze length is shortened', () => {
    setZone(LONDON);
    // Every 5 min, snooze 15 min: snoozing at 10:00 promises 10:15 (anchor 10:10, ahead of now).
    const snoozed = snooze(onboarded(custom({ workMin: 5, snoozeMin: 15 }), jun(9)), jun(10));
    const d = updateSettings(snoozed, { snoozeMin: 5 }, jun(10, 1));
    assert.equal(zoned(planBreaks(jun(10, 2), d.settings, d.timer).dueAt), zoned(jun(10, 15)), 'in memory: still rings at 10:15');
    // Measured against the new 5-minute snooze, the 10:10 anchor looks too far ahead. Because
    // timerFrom judges by the longest snooze choice, loading at 10:02 keeps the timer and
    // `snoozed`: the promised 10:15 reminder stays at 10:15.
    const loaded = load(JSON.stringify(d), jun(10, 2));
    assert.deepEqual(loaded.timer, d.timer);
    assert.equal(zoned(planBreaks(jun(10, 2), loaded.settings, loaded.timer).dueAt), zoned(jun(10, 15)), 'after loading');
  });

  it('a break that runs past the end of quiet hours: re-planning after the end books the same reminders', () => {
    setZone(LONDON);
    // Default settings (every 20 min, quiet 22:00–08:00). A 20 s break at 07:59:50 ends at 08:00:10.
    const d = startBreak(onboarded(DEFAULT_SETTINGS, jun(21)), jun(7, 59, 1, 50));
    const before = planBreaks(jun(7, 59, 1, 50), d.settings, d.timer, { max: 3 });
    const after = planBreaks(jun(8, 1, 1), d.settings, d.timer, { max: 3 });
    // Quiet hours end at 08:00, during the break (after setAt, before the anchor at the break's
    // end). cadenceStart counts from the anchor in that case, so planning before and after the
    // end agree: 08:20:10, 08:40:10, … both times, and no booked reminder moves.
    // (Fuzz walk #1, seed 1592598255, step 33.)
    assert.deepEqual(after.reminders.map(zoned), before.reminders.map(zoned));
    assert.equal(zoned(after.dueAt), zoned(before.dueAt), 'dueAt');
  });

  it('quiet hours that run on through a clock-change night never "end" while still quiet', () => {
    setZone(NEW_YORK);
    // 23.5-hour quiet hours leave a half-hour gap each night. On 8 March the clocks skip 02:00–03:00,
    // and on 1 November 01:00–02:00 happens twice: either way that night's gap never comes, and
    // quiet hours run on to the next night (isQuiet agrees).
    const cases = [
      { q: { enabled: true, startMin: 150, endMin: 120 }, set: new Date(2026, 2, 6, 20).getTime(), now: new Date(2026, 2, 8, 3, 10).getTime(), lastEnd: new Date(2026, 2, 7, 2).getTime() },
      { q: { enabled: true, startMin: 90, endMin: 60 }, set: new Date(2026, 9, 30, 20).getTime(), now: Date.UTC(2026, 10, 1, 6, 12), lastEnd: new Date(2026, 9, 31, 1).getTime() },
    ];
    for (const { q, set, now, lastEnd } of cases) {
      const label = `quiet ${fmtQuiet(q)} at ${zoned(now)}`;
      assert.equal(isQuiet(now, q), true, `${label}: quiet`);
      const end = lastQuietEnd(now, q)!;
      // That night's end time (03:00 EDT, the moment of the jump; or 01:00 EST, the second 01:00)
      // is still quiet, so lastQuietEnd must skip it and give the previous night's end. Otherwise
      // cadenceStart restarts the cadence inside quiet hours and dueAt lands at 03:20 EDT (or
      // 01:20 EST) instead of 20 min after quiet hours last ended.
      assert.equal(isQuiet(end, q), false, `${label}: lastQuietEnd ${zoned(end)} is still quiet`);
      assert.equal(zoned(end), zoned(lastEnd), `${label}: lastQuietEnd`);
      const timer: TimerState = { anchor: set, setAt: set, breakEndsAt: null };
      assert.equal(zoned(planBreaks(now, { ...DEFAULT_SETTINGS, quiet: q }, timer).dueAt), zoned(lastEnd + 20 * MINUTE), `${label}: dueAt`);
    }
  });

  it('renaming the duck keeps an emoji joined with a zero-width joiner whole', () => {
    const astronaut = `\u{1F469}${ZWJ}\u{1F680}`; // woman astronaut: woman + ZWJ + rocket, one emoji
    const family = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`; // family: man + ZWJ + woman + ZWJ + girl, one emoji
    // cleanName strips invisible characters, but must keep the zero-width joiner that holds these
    // emoji together: otherwise the astronaut becomes a woman and a rocket, and the family three
    // separate people. A name made only of joiners still falls back to Pip.
    assert.equal(renameDuck(onboarded(DEFAULT_SETTINGS, Date.UTC(2026, 5, 10)), `${astronaut} Pip`).pond.name, `${astronaut} Pip`);
    assert.equal(cleanName(`${family} family`), `${family} family`);
    assert.equal(cleanName(`${ZWJ}${ZWJ}`), 'Pip');
  });
});
