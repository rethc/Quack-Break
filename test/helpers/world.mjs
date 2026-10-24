// A fresh app for each test: new fakes and new copies of the services (their module-level state
// starts over), sharing nothing with other tests. Every import made for one world carries the
// same `?gen=N` query, which test/setup.mjs passes down to the whole module graph.
import { defaultData } from '../../src/core/types.ts';

/** Monday 26 October 2026, 10:00 UTC (setup.mjs runs the tests in UTC). Outside quiet hours. */
export const T0 = Date.UTC(2026, 9, 26, 10, 0, 0);
export const SEC = 1000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;

export const STATE_FILE = 'quack-state.json';
export const BACKUP_FILE = 'quack-state.bak';
export const TMP_FILE = 'quack-state.tmp';

let generation = 0;

/**
 * Saved app data for tests: onboarded, quiet hours OFF (so reminders are exactly every workMin),
 * anchored at `now`. Pass `quiet: true` to keep the default quiet hours (22:00 to 08:00).
 */
export function appData({ now = T0, onboarded = true, settings = {}, timer = {}, quiet = false, ...rest } = {}) {
  const d = defaultData(now);
  return {
    ...d,
    onboarded,
    settings: { ...d.settings, quiet: { ...d.settings.quiet, enabled: quiet }, ...settings },
    timer: { ...d.timer, ...timer },
    ...rest,
  };
}

/**
 * @param {object} [opts]
 * @param {'android'|'ios'} [opts.os]
 * @param {number|string} [opts.version] Android API level or iOS version.
 * @param {true|'old'|false} [opts.timer] The QuackTimer native module: present, present but from
 *   before sound previews (no playSound), or missing (iOS, old builds).
 * @param {object|string|null} [opts.data] Saved state (JSON-encoded unless a string). Default: none.
 * @param {Record<string,string>} [opts.files] Raw files in the document directory.
 * @param {boolean} [opts.permission] Notification permission (default granted).
 * @param {boolean} [opts.exact] Exact alarm permission (default granted).
 */
export async function world(opts = {}) {
  const gen = `${++generation}`;
  const url = (rel) => new URL(`${rel}?gen=${gen}`, import.meta.url).href;
  const os = opts.os ?? 'android';

  // Fakes first, configured before any service reads them at import time.
  const rn = await import(url('../fakes/react-native.mjs'));
  rn.Platform.OS = os;
  rn.Platform.Version = opts.version ?? (os === 'android' ? 35 : '18.0');

  const expo = await import(url('../fakes/expo.mjs'));
  const timerOpt = opts.timer ?? (os === 'android');
  expo.nativeModules.QuackTimer = timerOpt === false ? null : expo.makeQuackTimer({ sounds: timerOpt !== 'old' });

  const fs = await import(url('../fakes/expo-file-system.mjs'));
  if (opts.data !== undefined && opts.data !== null) {
    fs.disk.write(STATE_FILE, typeof opts.data === 'string' ? opts.data : JSON.stringify(opts.data));
  }
  for (const [name, text] of Object.entries(opts.files ?? {})) fs.disk.write(name, text);

  const N = await import(url('../fakes/expo-notifications.mjs'));
  N.fake.setPermission(opts.permission ?? true);
  N.fake.setExactAlarms(opts.exact ?? true);

  const haptics = await import(url('../fakes/expo-haptics.mjs'));
  const taskManager = await import(url('../fakes/expo-task-manager.mjs'));

  return {
    gen,
    os,
    rn,
    expo,
    /** The fake QuackTimer native module, or null. */
    native: expo.nativeModules.QuackTimer,
    fs,
    disk: fs.disk,
    N,
    notif: N.fake,
    haptics,
    taskManager,
    /** Import a service (or other module) from src/, e.g. load('services/notifications'). */
    load: (rel) => import(url(`../../src/${rel}.ts`)),
    /** The bridge in modules/quack-timer. */
    loadBridge: () => import(url('../../modules/quack-timer/index.ts')),
    /** The saved state file, parsed. */
    saved: () => fs.disk.json(STATE_FILE),
  };
}

/** Freeze the clock (Date only; timers stay real unless `timers` is set) at `now`. */
export function freeze(t, now = T0, { timers = false } = {}) {
  t.mock.timers.enable({ apis: timers ? ['Date', 'setTimeout', 'setInterval'] : ['Date'], now });
  return {
    now: () => Date.now(),
    set: (ms) => t.mock.timers.setTime(ms),
    tick: (ms) => t.mock.timers.tick(ms),
  };
}

/** Let pending promise callbacks run (one turn of the event loop). */
export const flush = () => new Promise((resolve) => setImmediate(resolve));

/** Silence console.warn for this test and return its calls. */
export function captureWarnings(t) {
  const calls = [];
  t.mock.method(console, 'warn', (...args) => calls.push(args));
  return calls;
}

export const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

/**
 * A notification response like expo-notifications gives. `payload` says where the kind is:
 * 'data' (content.data, as listeners get it), 'dataString' (as the Android background task gets
 * it), or 'none' (only the id prefix tells).
 */
export function response({
  id = `due_${T0}_abc`,
  kind = 'due',
  action = DEFAULT_ACTION,
  date = T0,
  payload = 'data',
  content = {},
} = {}) {
  const base = { title: 'Break time', body: 'Look far away.', ...content };
  const c =
    payload === 'data'
      ? { ...base, data: kind === undefined ? {} : { kind } }
      : payload === 'dataString'
        ? { ...base, dataString: JSON.stringify(kind === undefined ? {} : { kind }) }
        : base;
  return {
    actionIdentifier: action,
    notification: { date, request: { identifier: id, content: c, trigger: { type: 'date' } } },
  };
}
