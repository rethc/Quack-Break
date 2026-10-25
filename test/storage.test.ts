// services/storage: the JSON file, its backup and recovery, validation on read, and subscribers.
import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { DEFAULT_SETTINGS } from '../src/core/types.ts';
import { appData, BACKUP_FILE, captureWarnings, freeze, HOUR, MIN, STATE_FILE, T0, TMP_FILE, world } from './helpers/world.mjs';
import { callHook } from './helpers/react-hooks.mjs';

type Files = Record<string, string>;

async function setup(t: TestContext, files: Files = {}) {
  freeze(t, T0);
  const w = await world({ files });
  const storage = await w.load('services/storage');
  return { w, storage };
}

const good = (patch: Record<string, unknown> = {}) => JSON.stringify(appData(patch));
const named = (name: string) => good({ pond: { total: 3, lastAt: 0, name, wearing: null, seen: 3 } });

describe('storage: reading and writing', () => {
  it('fresh install: defaults, not onboarded, and nothing written until something changes', async (t) => {
    const { w, storage } = await setup(t);
    const d = storage.getData();
    assert.equal(d.onboarded, false);
    assert.deepEqual(d.settings, DEFAULT_SETTINGS);
    assert.deepEqual(w.disk.names(), []);
    storage.updateData((x: typeof d) => ({ ...x, onboarded: true }));
    assert.deepEqual(w.disk.names(), [STATE_FILE]);
  });

  it('round trip: the next process reads back exactly what was saved', async (t) => {
    const { w, storage } = await setup(t, { [STATE_FILE]: good() });
    storage.updateData((d: ReturnType<typeof appData>) => ({
      ...d,
      settings: { ...d.settings, startSound: 'bell', voice: 'michael', trayTimer: false },
      days: { '2026-10-25': 4 },
      handled: ['due_1|snooze'],
    }));
    const saved = storage.getData();
    t.mock.timers.reset();
    const next = await setup(t, { [STATE_FILE]: w.disk.read(STATE_FILE) });
    assert.deepEqual(next.storage.getData(), saved);
  });

  it('reads the disk once, then serves from memory', async (t) => {
    const { w, storage } = await setup(t, { [STATE_FILE]: good() });
    storage.getData();
    storage.getData();
    assert.deepEqual(w.disk.takeLog(), [`textSync ${STATE_FILE}`]);
  });

  it('saving writes a temp file, keeps the previous file as the backup, then moves the temp file in', async (t) => {
    const { w, storage } = await setup(t);
    storage.updateData((d: ReturnType<typeof appData>) => ({ ...d, onboarded: true }));
    assert.deepEqual(w.disk.takeLog(), [`writeSync ${TMP_FILE}`, `moveSync ${TMP_FILE} -> ${STATE_FILE}`]);
    const first = w.disk.read(STATE_FILE);
    storage.updateData((d: ReturnType<typeof appData>) => ({ ...d, handled: ['x|y'] }));
    assert.deepEqual(w.disk.takeLog(), [
      `writeSync ${TMP_FILE}`,
      `copySync ${STATE_FILE} -> ${BACKUP_FILE}`,
      `moveSync ${TMP_FILE} -> ${STATE_FILE}`,
    ]);
    assert.equal(w.disk.read(BACKUP_FILE), first);
    assert.deepEqual(w.disk.json(STATE_FILE).handled, ['x|y']);
    assert.equal(w.disk.has(TMP_FILE), false);
  });

  it('updateData returns the new state; a change that returns the same object writes nothing', async (t) => {
    const { w, storage } = await setup(t, { [STATE_FILE]: good() });
    const before = storage.getData();
    assert.equal(storage.updateData((d: unknown) => d), before);
    assert.deepEqual(w.disk.takeLog(), [`textSync ${STATE_FILE}`]);
  });

  it('reloadData picks up what another process (the background task) saved', async (t) => {
    const { w, storage } = await setup(t, { [STATE_FILE]: good() });
    assert.equal(storage.getData().settings.snoozeMin, 5);
    w.disk.write(STATE_FILE, good({ settings: { snoozeMin: 15 } }));
    assert.equal(storage.getData().settings.snoozeMin, 5, 'cached until reloaded');
    storage.reloadData();
    assert.equal(storage.getData().settings.snoozeMin, 15);
  });
});

describe('storage: recovery', () => {
  it('a damaged main file: the backup is used, and the damaged file is deleted before it could be backed up', async (t) => {
    const { w, storage } = await setup(t, { [STATE_FILE]: '{"onboarded": tru', [BACKUP_FILE]: named('Backup') });
    const warnings = captureWarnings(t);
    assert.equal(storage.getData().pond.name, 'Backup');
    assert.ok(warnings.some(([m]) => /unreadable, trying the backup/.test(String(m))));
    const log = w.disk.takeLog();
    assert.ok(log.includes(`delete ${STATE_FILE}`));
    assert.ok(!log.some((l: string) => l.startsWith('copySync')), `the damaged file never overwrites the backup: ${log}`);
    assert.equal(w.disk.json(STATE_FILE).pond.name, 'Backup', 'main rewritten from the backup');
    assert.equal(w.disk.json(BACKUP_FILE).pond.name, 'Backup');
    // And the next save keeps the good state as its backup.
    storage.updateData((d: ReturnType<typeof appData>) => ({ ...d, handled: ['a|b'] }));
    assert.equal(w.disk.json(BACKUP_FILE).pond.name, 'Backup');
  });

  for (const [what, text] of [
    ['a number', '42'],
    ['a string', '"hello"'],
    ['null', 'null'],
    ['true', 'true'],
    ['an empty file', ''],
    ['whitespace', '  \n'],
  ]) {
    it(`a main file holding ${what} is unreadable: the backup is used`, async (t) => {
      const { storage } = await setup(t, { [STATE_FILE]: text!, [BACKUP_FILE]: named('Backup') });
      captureWarnings(t);
      assert.equal(storage.getData().pond.name, 'Backup');
      assert.equal(storage.getData().onboarded, true);
    });
  }

  it('a main file holding a JSON array is not a saved state: the backup is used', async (t) => {
    const { storage } = await setup(t, { [STATE_FILE]: '[]', [BACKUP_FILE]: named('Backup') });
    captureWarnings(t);
    // A main file holding `[]` isn't a saved state (arrays are objects too): the good backup must
    // be used, not a fresh start.
    assert.equal(storage.getData().pond.name, 'Backup');
    assert.equal(storage.getData().onboarded, true);
  });

  it('a missing main file with a good backup (crash mid-save): the backup is used and becomes the main file', async (t) => {
    const { w, storage } = await setup(t, { [BACKUP_FILE]: named('Backup') });
    captureWarnings(t);
    assert.equal(storage.getData().pond.name, 'Backup');
    assert.equal(w.disk.json(STATE_FILE).pond.name, 'Backup');
  });

  it('a good main file wins over a damaged backup, which is left alone', async (t) => {
    const { w, storage } = await setup(t, { [STATE_FILE]: named('Main'), [BACKUP_FILE]: 'garbage' });
    assert.equal(storage.getData().pond.name, 'Main');
    assert.deepEqual(w.disk.takeLog(), [`textSync ${STATE_FILE}`]);
  });

  it('both files unreadable: start fresh with defaults, with a warning', async (t) => {
    const { storage } = await setup(t, { [STATE_FILE]: 'x', [BACKUP_FILE]: 'y' });
    const warnings = captureWarnings(t);
    const d = storage.getData();
    assert.equal(d.onboarded, false);
    assert.deepEqual(d.settings, DEFAULT_SETTINGS);
    assert.ok(warnings.some(([m]) => /starting fresh/.test(String(m))));
  });

  it('a damaged main file and no backup: defaults', async (t) => {
    const { storage } = await setup(t, { [STATE_FILE]: '{' });
    captureWarnings(t);
    assert.equal(storage.getData().onboarded, false);
  });

  it('a save failing at the backup copy: the change stays in memory, disk keeps the last good state, the next save writes both', async (t) => {
    const { w, storage } = await setup(t, { [STATE_FILE]: good() });
    const warnings = captureWarnings(t);
    w.disk.fail('copySync', STATE_FILE);
    storage.updateData((d: ReturnType<typeof appData>) => ({ ...d, handled: ['one|a'] }));
    assert.ok(warnings.some(([m]) => m === 'Could not save state'));
    assert.deepEqual(storage.getData().handled, ['one|a']);
    assert.deepEqual(w.disk.json(STATE_FILE).handled, [], 'last good state on disk');
    storage.updateData((d: ReturnType<typeof appData>) => ({ ...d, handled: [...d.handled, 'two|b'] }));
    assert.deepEqual(w.disk.json(STATE_FILE).handled, ['one|a', 'two|b']);
  });

  it('a save failing at the final move leaves a complete, readable previous state', async (t) => {
    const { w, storage } = await setup(t, { [STATE_FILE]: named('Before') });
    captureWarnings(t);
    w.disk.fail('moveSync', TMP_FILE);
    storage.updateData((d: ReturnType<typeof appData>) => ({ ...d, pond: { ...d.pond, name: 'After' } }));
    assert.equal(w.disk.json(STATE_FILE).pond.name, 'Before');
    assert.equal(w.disk.json(BACKUP_FILE).pond.name, 'Before');
    storage.reloadData();
    assert.equal(storage.getData().pond.name, 'Before');
  });

  it('a save failing at the temp file changes nothing on disk', async (t) => {
    const { w, storage } = await setup(t, { [STATE_FILE]: named('Before') });
    captureWarnings(t);
    const before = w.disk.read(STATE_FILE);
    w.disk.fail('writeSync', TMP_FILE);
    storage.updateData((d: ReturnType<typeof appData>) => ({ ...d, pond: { ...d.pond, name: 'After' } }));
    assert.equal(w.disk.read(STATE_FILE), before);
    assert.equal(w.disk.has(BACKUP_FILE), false);
  });
});

describe('storage: checking what is read', () => {
  it('keeps only valid day counts, string handled keys (last 30), and onboarded only if exactly true', async (t) => {
    const raw = {
      ...appData(),
      onboarded: 'yes',
      days: { '2026-10-20': 3, '2026-10-21': 0, '2026-10-22': -2, '2026-10-23': 1.5, '20261024': 2, '2026-10-25': '4', '2026-10-26': 6 },
      handled: [...Array.from({ length: 35 }, (_, i) => `k${i}`), 7, null],
    };
    const { storage } = await setup(t, { [STATE_FILE]: JSON.stringify(raw) });
    const d = storage.getData();
    assert.equal(d.onboarded, false);
    assert.deepEqual(d.days, { '2026-10-20': 3, '2026-10-26': 6 });
    assert.equal(d.handled.length, 30);
    assert.equal(d.handled[0], 'k5');
    assert.equal(d.handled[29], 'k34');
    assert.equal(d.v, 1);
  });

  it('replaces invalid settings and a timer set far in the future (clock went back)', async (t) => {
    const raw = appData({ settings: { rule202020: false, workMin: 0, snoozeMin: 7, startSound: 'trumpet' } });
    raw.timer = { anchor: T0 + 30 * 24 * HOUR, setAt: T0, breakEndsAt: T0 + 5 * HOUR };
    const { storage } = await setup(t, { [STATE_FILE]: JSON.stringify(raw) });
    const d = storage.getData();
    assert.equal(d.settings.workMin, DEFAULT_SETTINGS.workMin);
    assert.equal(d.settings.snoozeMin, DEFAULT_SETTINGS.snoozeMin);
    assert.equal(d.settings.startSound, DEFAULT_SETTINGS.startSound);
    assert.deepEqual(d.timer, { anchor: T0, setAt: T0, breakEndsAt: null });
  });

  it('older saves with no pond: the pond starts with every break already taken, all seen', async (t) => {
    const raw: Record<string, unknown> = { ...appData(), days: { '2026-10-20': 3, '2026-10-21': 4, junk: 9 } };
    delete raw.pond;
    const { storage } = await setup(t, { [STATE_FILE]: JSON.stringify(raw) });
    assert.deepEqual(storage.getData().pond, { total: 7, lastAt: 0, name: 'Jenny', wearing: null, seen: 7 });
  });

  it('a saved pond is kept', async (t) => {
    const pond = { total: 45, lastAt: T0 - HOUR, name: 'Quackers', wearing: 'beanie', seen: 40 };
    const { storage } = await setup(t, { [STATE_FILE]: good({ pond, days: { '2026-10-20': 2 } }) });
    assert.deepEqual(storage.getData().pond, pond);
  });

  it('older saves (v0.1 sound switch) still load with their sound choice', async (t) => {
    const raw = appData();
    (raw.settings as Record<string, unknown>) = { sound: false, haptics: true, workMin: 20, breakSec: 20 };
    const { storage } = await setup(t, { [STATE_FILE]: JSON.stringify(raw) });
    const s = storage.getData().settings;
    assert.equal(s.startSound, 'none');
    assert.equal(s.startVibrate, true);
  });
});

describe('storage: subscribers (useData)', () => {
  it('useData returns the selected part of the state', async (t) => {
    const { storage } = await setup(t, { [STATE_FILE]: good() });
    const { value } = callHook(() => storage.useData((d: ReturnType<typeof appData>) => d.settings.snoozeMin));
    assert.equal(value, 5);
  });

  it('subscribers hear about changes, only real ones, and reloads; unsubscribing stops it', async (t) => {
    const { storage } = await setup(t, { [STATE_FILE]: good() });
    const { subscribe, getSnapshot } = callHook(() => storage.useData((d: ReturnType<typeof appData>) => d.timer));
    let calls = 0;
    const unsubscribe = subscribe(() => calls++);
    storage.updateData((d: ReturnType<typeof appData>) => ({ ...d, timer: { ...d.timer, anchor: T0 + MIN } }));
    assert.equal(calls, 1);
    assert.equal(getSnapshot().anchor, T0 + MIN);
    storage.updateData((d: unknown) => d);
    assert.equal(calls, 1, 'no change, no call');
    storage.reloadData();
    assert.equal(calls, 2, 'a reload always tells');
    unsubscribe();
    storage.updateData((d: ReturnType<typeof appData>) => ({ ...d, handled: ['z|z'] }));
    assert.equal(calls, 2);
  });

  it('the snapshot is stable between changes (no new objects, as useSyncExternalStore needs)', async (t) => {
    const { storage } = await setup(t, { [STATE_FILE]: good() });
    const { getSnapshot } = callHook(() => storage.useData((d: ReturnType<typeof appData>) => d.settings));
    assert.equal(getSnapshot(), getSnapshot());
  });
});
