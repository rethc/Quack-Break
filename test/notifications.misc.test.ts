// The foreground notification handler, sound previews, the test reminder, permissions,
// exact alarms and the channel settings shortcut.
import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { appData, freeze, MIN, response, SEC, T0, world } from './helpers/world.mjs';

const VIBRATION = [0, 120, 90, 160];
const HIDDEN_WITH_SOUND = { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: true, shouldSetBadge: false };
const SHOWN_WITH_SOUND = { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };

async function setup(t: TestContext, settings: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) {
  const clock = freeze(t, T0);
  const w = await world({ data: appData({ settings }), ...opts });
  const N = await w.load('services/notifications');
  return { w, N, clock };
}

const notification = (kind: string | undefined, id = `${kind}_1`, payload: 'data' | 'dataString' | 'none' = 'data') =>
  response({ id, kind, payload }).notification;

describe('notification handler (app in the foreground)', () => {
  async function handlerSetup(t: TestContext, settings: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) {
    const s = await setup(t, settings, opts);
    s.N.installNotificationHandler();
    return s;
  }

  it('a preview only plays its sound, and does not buzz', async (t) => {
    const { w } = await handlerSetup(t);
    assert.deepEqual(await w.notif.handle(notification('preview')), HIDDEN_WITH_SOUND);
    assert.deepEqual(w.rn.Vibration.calls, []);
  });

  it('a reminder is hidden (the app shows the break) but quacks and buzzes', async (t) => {
    const { w } = await handlerSetup(t);
    assert.deepEqual(await w.notif.handle(notification('due')), HIDDEN_WITH_SOUND);
    assert.deepEqual(w.rn.Vibration.calls, [VIBRATION]);
  });

  it('break over is hidden, with the end sound and end vibration', async (t) => {
    const { w } = await handlerSetup(t, { startSound: 'none', startVibrate: false });
    assert.deepEqual(await w.notif.handle(notification('over')), HIDDEN_WITH_SOUND);
    assert.deepEqual(w.rn.Vibration.calls, [VIBRATION]);
  });

  it('break over with sound None and no vibration: hidden, silent, no buzz', async (t) => {
    const { w } = await handlerSetup(t, { endSound: 'none', endVibrate: false });
    assert.deepEqual(await w.notif.handle(notification('over')), { ...HIDDEN_WITH_SOUND, shouldPlaySound: false });
    assert.deepEqual(w.rn.Vibration.calls, []);
  });

  it('a reminder with sound None only buzzes', async (t) => {
    const { w } = await handlerSetup(t, { startSound: 'none' });
    assert.deepEqual(await w.notif.handle(notification('due')), { ...HIDDEN_WITH_SOUND, shouldPlaySound: false });
    assert.deepEqual(w.rn.Vibration.calls, [VIBRATION]);
  });

  it('iOS buzzes with a success haptic instead of the vibrator', async (t) => {
    const { w } = await handlerSetup(t, {}, { os: 'ios' });
    await w.notif.handle(notification('due'));
    assert.deepEqual(w.haptics.calls, [{ fn: 'notificationAsync', arg: 'success' }]);
  });

  for (const kind of ['test', 'out', undefined]) {
    it(`${kind ?? 'someone else'}'s notification is shown, with the reminder sound, without a buzz`, async (t) => {
      const { w } = await handlerSetup(t);
      const n = kind ? notification(kind) : notification(undefined, 'other_1', 'none');
      assert.deepEqual(await w.notif.handle(n), SHOWN_WITH_SOUND);
      assert.deepEqual(w.rn.Vibration.calls, []);
    });
  }

  it('reads the kind from dataString too', async (t) => {
    const { w } = await handlerSetup(t);
    assert.deepEqual(await w.notif.handle(notification('due', 'abc', 'dataString')), HIDDEN_WITH_SOUND);
  });

  it('buzzes once for alerts less than 2 s apart', async (t) => {
    const { w, clock } = await handlerSetup(t);
    await w.notif.handle(notification('due'));
    clock.set(T0 + 1500);
    await w.notif.handle(notification('over'));
    assert.equal(w.rn.Vibration.calls.length, 1);
    clock.set(T0 + 4 * SEC);
    await w.notif.handle(notification('due'));
    assert.equal(w.rn.Vibration.calls.length, 2);
  });
});

describe('previewMoment', () => {
  it('Android timer module: plays the sound file directly, with no notification and no channel', async (t) => {
    const { w, N } = await setup(t);
    await N.previewMoment('start');
    assert.deepEqual(w.native.soundCalls, [{ sound: 'quack.wav', channelId: null }]);
    assert.equal(w.notif.callsOf('scheduleNotificationAsync').length, 0);
    assert.equal(w.notif.callsOf('setNotificationChannelAsync').length, 0);
  });

  it("Android timer module: Phone sound plays through the moment's channel, made first", async (t) => {
    const { w, N } = await setup(t, { startSound: 'phone', endSound: 'phone' });
    await N.previewMoment('end');
    assert.deepEqual(w.native.soundCalls, [{ sound: 'default', channelId: 'alerts2_end_default_v' }]);
    assert.ok(w.notif.channelIds().includes('alerts2_end_default_v'));
  });

  it('voice previews use the voice file for the moment', async (t) => {
    const { w, N } = await setup(t, { startSound: 'voice', endSound: 'voice', voice: 'george' });
    await N.previewMoment('start');
    await N.previewMoment('end');
    assert.deepEqual(
      w.native.soundCalls.map((c: { sound: string }) => c.sound),
      ['voice_george_rest.wav', 'voice_george_work.wav'],
    );
  });

  it('every tap restarts the preview on Android (no debounce there)', async (t) => {
    const { w, N } = await setup(t);
    await N.previewMoment('start');
    await N.previewMoment('start');
    assert.equal(w.native.soundCalls.length, 2);
  });

  it('sound None stops any preview and plays nothing', async (t) => {
    const { w, N } = await setup(t, { startSound: 'none' });
    await N.previewMoment('start');
    assert.equal(w.native.stopCalls, 1);
    assert.deepEqual(w.native.soundCalls, []);
  });

  it('stopPreview stops the native preview', async (t) => {
    const { w, N } = await setup(t);
    N.stopPreview();
    assert.equal(w.native.stopCalls, 1);
  });

  it('iOS: posts a sound-only preview notification at once', async (t) => {
    const { w, N } = await setup(t, {}, { os: 'ios' });
    await N.previewMoment('start');
    assert.deepEqual(w.notif.state.presented, [
      { identifier: `preview_${T0}`, content: { title: 'Preview', data: { kind: 'preview' }, sound: 'quack.wav' }, trigger: null },
    ]);
  });

  it('iOS: the same sound tapped again within 1.5 s is ignored; later, or another sound, plays', async (t) => {
    const { w, N, clock } = await setup(t, { endSound: 'bell' }, { os: 'ios' });
    await N.previewMoment('start');
    clock.set(T0 + 1000);
    await N.previewMoment('start');
    assert.equal(w.notif.state.presented.length, 1);
    await N.previewMoment('end');
    assert.equal(w.notif.state.presented.length, 2);
    clock.set(T0 + 1000 + 1600);
    await N.previewMoment('end');
    assert.equal(w.notif.state.presented.length, 3);
  });

  it("Android build without the sound preview: posts the preview on the moment's channel", async (t) => {
    const { w, N } = await setup(t, { endSound: 'drop' }, { timer: 'old' });
    await N.previewMoment('end');
    const [p] = w.notif.state.presented;
    assert.deepEqual(p.trigger, { type: 'channel', channelId: 'alerts2_end_drop_v' });
    assert.equal(p.content.sound, 'drop.wav');
  });
});

describe('sendTestReminder', () => {
  it('Android: books a test reminder in 10 s on the reminder channel, with the buttons', async (t) => {
    const { w, N } = await setup(t);
    await N.sendTestReminder();
    const [r] = w.notif.scheduled();
    assert.equal(r.identifier, `test_${T0}`);
    assert.deepEqual(r.trigger, { type: 'timeInterval', seconds: 10, repeats: false, channelId: 'alerts2_start_quack_v' });
    assert.deepEqual(r.content.data, { kind: 'test' });
    assert.equal(r.content.categoryIdentifier, 'break_due');
    assert.equal(r.content.sound, 'quack.wav');
    assert.deepEqual(r.content.vibrate, VIBRATION);
    const actions = w.notif.state.categories.get('break_due').actions;
    assert.deepEqual(actions, [
      { identifier: 'start_break', buttonTitle: 'Start', options: { opensAppToForeground: false } },
      { identifier: 'snooze', buttonTitle: 'Snooze 5 min', options: { opensAppToForeground: false } },
    ]);
  });

  it('iOS: no channel, and Start opens the app', async (t) => {
    const { w, N } = await setup(t, {}, { os: 'ios' });
    await N.sendTestReminder(3);
    const [r] = w.notif.scheduled();
    assert.deepEqual(r.trigger, { type: 'timeInterval', seconds: 3, repeats: false });
    assert.equal(w.notif.state.categories.get('break_due').actions[0].options.opensAppToForeground, true);
  });

  it('a test reminder tapped is a real break', async (t) => {
    const { N, w } = await setup(t);
    await N.sendTestReminder();
    const r = response({ id: `test_${T0}`, kind: 'test', action: 'start_break', date: T0 + 10 * SEC });
    assert.equal(N.applyResponse(r, true), 'break');
    assert.equal(w.saved().timer.breakEndsAt, T0 + 20 * SEC);
  });
});

describe('permissions', () => {
  it('canNotify: granted, denied, iOS provisional, iOS denied', async (t) => {
    const { w, N } = await setup(t, {}, { os: 'ios' });
    const { IosAuthorizationStatus: S } = w.N;
    const cases: [boolean, number | undefined, boolean][] = [
      [true, undefined, true],
      [false, undefined, false],
      [false, S.PROVISIONAL, true],
      [false, S.DENIED, false],
      [false, S.NOT_DETERMINED, false],
    ];
    for (const [granted, ios, expected] of cases) {
      w.notif.setPermission(granted, ios);
      assert.equal(await N.canNotify(), expected, `granted=${granted} ios=${ios}`);
    }
  });

  it('Android: requesting permission creates the channels first (Android 13 shows no prompt without one)', async (t) => {
    const { w, N } = await setup(t, {}, { permission: false });
    w.notif.setRequestResult(true);
    assert.equal(await N.requestNotificationPermission(), true);
    const channels = w.notif.seqOf('setNotificationChannelAsync');
    const [request] = w.notif.seqOf('requestPermissionsAsync');
    assert.equal(channels.length, 2);
    assert.ok(Math.max(...channels) < request);
  });

  it('iOS: asks for alerts and sounds, not badges; provisional counts as yes, denied as no', async (t) => {
    const { w, N } = await setup(t, {}, { os: 'ios', permission: false });
    w.notif.setRequestResult(false, w.N.IosAuthorizationStatus.PROVISIONAL);
    assert.equal(await N.requestNotificationPermission(), true);
    assert.deepEqual(w.notif.callsOf('requestPermissionsAsync'), [
      [{ ios: { allowAlert: true, allowSound: true, allowBadge: false } }],
    ]);
    w.notif.setRequestResult(false, w.N.IosAuthorizationStatus.DENIED);
    assert.equal(await N.requestNotificationPermission(), false);
  });
});

describe('exact alarms', () => {
  it('Android 12+: needs the permission and reports it', async (t) => {
    const { w, N } = await setup(t, {}, { version: 31 });
    assert.equal(N.needsExactAlarmPermission, true);
    assert.equal(await N.hasExactAlarms(), true);
    w.notif.setExactAlarms(false);
    assert.equal(await N.hasExactAlarms(), false);
  });

  it('Android 12+: a failing check counts as granted, a failing request as not granted', async (t) => {
    const { w, N } = await setup(t);
    w.notif.state.exactThrows = new Error('not available');
    assert.equal(await N.hasExactAlarms(), true);
    assert.equal(await N.requestExactAlarms(), false);
  });

  it('Android 12+: requesting returns the new state', async (t) => {
    const { w, N } = await setup(t, {}, { exact: false });
    w.notif.state.requestExactResult = { granted: true };
    assert.equal(await N.requestExactAlarms(), true);
    assert.equal(await N.hasExactAlarms(), true);
  });

  it('Android 11 and iOS: always yes, without asking', async (t) => {
    for (const opts of [{ version: 30 }, { os: 'ios' }]) {
      const { w, N } = await setup(t, {}, { ...opts, exact: false });
      assert.equal(N.needsExactAlarmPermission, false);
      assert.equal(await N.hasExactAlarms(), true);
      assert.equal(await N.requestExactAlarms(), true);
      assert.equal(w.notif.callsOf('getExactAlarmPermissionsAsync').length, 0);
      assert.equal(w.notif.callsOf('requestExactAlarmPermissionsAsync').length, 0);
      t.mock.timers.reset();
    }
  });
});

describe('openChannelSettings', () => {
  it("Android: opens the moment's channel in the system settings", async (t) => {
    const { w, N } = await setup(t, { startSound: 'phone' });
    await N.openChannelSettings('start');
    assert.deepEqual(w.rn.Linking.calls, [
      {
        fn: 'sendIntent',
        args: [
          'android.settings.CHANNEL_NOTIFICATION_SETTINGS',
          [
            { key: 'android.provider.extra.APP_PACKAGE', value: 'com.chesd.quackbreak' },
            { key: 'android.provider.extra.CHANNEL_ID', value: 'alerts2_start_default_v' },
          ],
        ],
      },
    ]);
    assert.ok(w.notif.channelIds().includes('alerts2_start_default_v'), 'the channel exists before opening it');
  });

  it("Android: falls back to the app's settings if that screen can't open", async (t) => {
    const { w, N } = await setup(t);
    w.rn.Linking.sendIntentError = new Error('ActivityNotFound');
    await N.openChannelSettings('end');
    assert.deepEqual(
      w.rn.Linking.calls.map((c: { fn: string }) => c.fn),
      ['sendIntent', 'openSettings'],
    );
  });

  it('iOS: does nothing', async (t) => {
    const { w, N } = await setup(t, {}, { os: 'ios' });
    await N.openChannelSettings('start');
    assert.deepEqual(w.rn.Linking.calls, []);
  });
});

describe('dismissing the tapped notification', () => {
  it('a failing dismiss is ignored: the response still applies, with no unhandled rejection', async (t) => {
    const { w, N } = await setup(t);
    w.notif.state.dismissError = new Error('gone');
    let unhandled: unknown = null;
    const onUnhandled = (e: unknown) => (unhandled = e);
    process.on('unhandledRejection', onUnhandled);
    t.after(() => process.off('unhandledRejection', onUnhandled));
    assert.equal(N.applyResponse(response({ date: T0 - MIN, action: 'start_break' }), false), 'break');
    await new Promise((r) => setImmediate(r));
    assert.equal(unhandled, null);
    assert.equal(w.notif.callsOf('dismissNotificationAsync').length, 1);
  });
});
