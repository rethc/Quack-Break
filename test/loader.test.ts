// Checks on the test setup itself (test/setup.mjs, helpers/world.mjs): if these fail, the other
// results can't be trusted.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { appData, T0, world } from './helpers/world.mjs';

const SERVICES = readdirSync(new URL('../src/services/', import.meta.url))
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => f.replace(/\.ts$/, ''));

describe('test loader', () => {
  it('runs in UTC, so quiet hours land at the same instants on every machine', () => {
    assert.equal(new Date(T0).getHours(), 10);
    assert.equal(new Date(T0).getTimezoneOffset(), 0);
  });

  it('loads every service with Node type stripping, on Android and iOS, without UI code or unfaked packages', async () => {
    assert.ok(SERVICES.includes('notifications') && SERVICES.length >= 8, `found ${SERVICES.join(', ')}`);
    for (const os of ['android', 'ios'] as const) {
      const w = await world({ os });
      for (const name of SERVICES) {
        const mod = await w.load(`services/${name}`);
        assert.ok(mod && typeof mod === 'object', `${os}: services/${name}`);
      }
    }
  });

  it("resolves the services' '../../modules/quack-timer' import to this world's fake native module", async () => {
    const w = await world({ data: appData() });
    const timer = await w.load('services/timer');
    timer.updateTimer(null);
    assert.equal(w.native.plans.length, 1);
    assert.deepEqual(w.expo.requested, ['QuackTimer']);
  });

  it('gives each world its own module state and its own fakes', async () => {
    const a = await world({ data: appData() });
    const b = await world({ os: 'ios' });
    const ta = await a.load('services/timer');
    const tb = await b.load('services/timer');
    assert.equal(ta.timerAvailable, true);
    assert.equal(tb.timerAvailable, false);
    assert.notEqual(a.rn.Platform, b.rn.Platform);
    const sa = await a.load('services/storage');
    const sb = await b.load('services/storage');
    assert.notEqual(sa.getData, sb.getData);
    assert.equal(sa.getData().onboarded, true);
    assert.equal(sb.getData().onboarded, false);
  });

  it('the bridge does nothing, quietly, when the native module is missing', async () => {
    const w = await world({ os: 'android', timer: false });
    const bridge = await w.loadBridge();
    assert.equal(bridge.timerAvailable, false);
    assert.equal(bridge.soundPreviewAvailable, false);
    assert.deepEqual(bridge.takeTimerActions(), []);
    bridge.setTimerPlan({} as never);
    bridge.playPreviewSound('quack.wav');
    bridge.stopPreviewSound();
    const off = bridge.onTimerAction(() => {});
    off();
  });

  it('refuses a module that imports a .tsx file, naming it', async () => {
    await assert.rejects(import('./fixtures/uses-ui.mjs'), /imports UI code .*Widget\.tsx/);
  });

  it('refuses a native package that has no fake, naming it', async () => {
    await assert.rejects(import('./fixtures/uses-router.mjs'), /No test fake for 'expo-router'/);
  });
});
