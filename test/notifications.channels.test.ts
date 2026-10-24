// Android notification channels: ids per sound and vibration, settings, pruning, remindersBlocked.
import assert from 'node:assert/strict';
import { describe, it, type TestContext } from 'node:test';

import { appData, flush, freeze, T0, world } from './helpers/world.mjs';

const VIBRATION = [0, 120, 90, 160];

async function setup(t: TestContext, settings: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) {
  freeze(t, T0);
  const w = await world({ data: appData({ settings }), ...opts });
  const N = await w.load('services/notifications');
  return { w, N };
}

describe('channel ids', () => {
  const cases: [string, Record<string, unknown>, { start: string; end: string }][] = [
    ['quack, vibrate', {}, { start: 'alerts2_start_quack_v', end: 'alerts2_end_quack_v' }],
    [
      'chime start without vibration, bell end',
      { startSound: 'chime', startVibrate: false, endSound: 'bell' },
      { start: 'alerts2_start_chime_n', end: 'alerts2_end_bell_v' },
    ],
    [
      'voice: a file per voice and moment',
      { startSound: 'voice', endSound: 'voice', voice: 'bella' },
      { start: 'alerts2_start_voice_bella_rest_v', end: 'alerts2_end_voice_bella_work_v' },
    ],
    ['phone sound', { startSound: 'phone', endSound: 'phone' }, { start: 'alerts2_start_default_v', end: 'alerts2_end_default_v' }],
    [
      'none, vibrate only / silent',
      { startSound: 'none', endSound: 'none', endVibrate: false },
      { start: 'alerts2_start_none_v', end: 'alerts2_end_none_n' },
    ],
  ];
  for (const [name, settings, ids] of cases) {
    it(`${name}: ${ids.start} / ${ids.end}`, async (t) => {
      const { w, N } = await setup(t, settings);
      assert.deepEqual(await N.ensureChannels(), ids);
      assert.deepEqual(w.notif.channelIds(), [ids.end, ids.start].sort());
    });
  }

  it('iOS has no channels: ensureChannels returns undefined and creates none', async (t) => {
    const { w, N } = await setup(t, {}, { os: 'ios' });
    assert.equal(await N.ensureChannels(), undefined);
    assert.equal(w.notif.callsOf('setNotificationChannelAsync').length, 0);
  });
});

describe('channel settings', () => {
  it('a sound file: high importance, the sound, the vibration pattern, public on the lock screen, no badge', async (t) => {
    const { w, N } = await setup(t);
    await N.ensureChannels();
    const [[id, input]] = w.notif.callsOf('setNotificationChannelAsync');
    assert.equal(id, 'alerts2_start_quack_v');
    assert.deepEqual(input, {
      name: 'Break reminders',
      description: "When it's time for an eye break",
      importance: w.N.AndroidImportance.HIGH,
      sound: 'quack.wav',
      enableVibrate: true,
      vibrationPattern: VIBRATION,
      lockscreenVisibility: w.N.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
    });
    const end = w.notif.callsOf('setNotificationChannelAsync')[1][1];
    assert.equal(end.name, 'Break over');
  });

  it("phone sound: no sound key at all (the phone's own sound); none: sound null (silent)", async (t) => {
    const { w, N } = await setup(t, { startSound: 'phone', endSound: 'none' });
    await N.ensureChannels();
    const start = w.notif.channel('alerts2_start_default_v');
    const end = w.notif.channel('alerts2_end_none_v');
    assert.equal(start.hasSoundKey, false, '"default" is not accepted for channels');
    assert.equal(end.hasSoundKey, true);
    assert.equal(end.soundFile, null);
  });

  it('no vibration: vibration off and no pattern', async (t) => {
    const { w, N } = await setup(t, { startVibrate: false });
    await N.ensureChannels();
    const [, input] = w.notif.callsOf('setNotificationChannelAsync')[0];
    assert.equal(input.enableVibrate, false);
    assert.equal(input.vibrationPattern, undefined);
  });

  it('channels are created once for the same settings', async (t) => {
    const { w, N } = await setup(t);
    await N.ensureChannels();
    await N.ensureChannels();
    await N.syncSchedule();
    assert.equal(w.notif.callsOf('setNotificationChannelAsync').length, 2);
  });
});

describe('pruning channels', () => {
  it('after a sound change, reminders move to the new channel, and the old channel is deleted after they are booked', async (t) => {
    const { w, N } = await setup(t);
    await N.syncSchedule();
    const settings = await w.load('services/settings');
    settings.saveSettings({ startSound: 'chime' }, { sync: false });
    w.notif.clearCalls();
    await N.syncSchedule();

    assert.deepEqual(w.notif.channelIds(), ['alerts2_end_quack_v', 'alerts2_start_chime_v']);
    for (const r of w.notif.scheduled()) {
      assert.equal(r.trigger.channelId, 'alerts2_start_chime_v', r.identifier);
      assert.equal(r.content.sound, 'chime.wav');
    }
    const lastBooking = Math.max(...w.notif.seqOf('scheduleNotificationAsync'));
    const deletions = w.notif.seqOf('deleteNotificationChannelAsync');
    assert.deepEqual(w.notif.callsOf('deleteNotificationChannelAsync'), [['alerts2_start_quack_v']]);
    assert.ok(deletions.every((n: number) => n > lastBooking), 'deleted only after rebooking');
  });

  it("removes this app's channels from older builds and keeps channels in use and channels it doesn't own", async (t) => {
    const { w, N } = await setup(t);
    w.notif.addChannel('breaks_start_quack');
    w.notif.addChannel('alerts2_start_drop_n');
    w.notif.addChannel('quack_timer');
    w.notif.addChannel('expo_default');
    await N.syncSchedule();
    assert.deepEqual(w.notif.channelIds(), ['alerts2_end_quack_v', 'alerts2_start_quack_v', 'expo_default', 'quack_timer']);
  });

  it('a channel that cannot be deleted does not stop the sync', async (t) => {
    const { w, N } = await setup(t);
    w.notif.addChannel('breaks_old');
    w.notif.state.deleteChannelFailure = () => new Error('SecurityException');
    await N.syncSchedule();
    assert.ok(w.notif.scheduledIds().length > 0);
    assert.equal(w.native.plans.length, 1, 'the tray timer is still updated');
  });

  it('channels created for settings that were never synced are pruned once the settings settle', async (t) => {
    // The sound picker saves with sync: false and previews as you tap. Previewing "Phone sound"
    // creates its channel; picking Quack again and closing the picker syncs.
    const { w, N } = await setup(t);
    await N.syncSchedule();
    const settings = await w.load('services/settings');
    settings.saveSettings({ startSound: 'phone' }, { sync: false });
    await N.previewMoment('start');
    assert.ok(w.notif.channelIds().includes('alerts2_start_default_v'), 'preview made the phone-sound channel');
    settings.saveSettings({ startSound: 'quack' }, { sync: false });
    await N.syncSchedule();
    // ensureChannels (via previewMoment, openChannelSettings, remindersBlocked, sendTestReminder)
    // can create channels between syncs, so going back to the last synced sound must still prune:
    // the unused 'alerts2_start_default_v' channel doesn't linger in Android's settings.
    assert.deepEqual(w.notif.channelIds(), ['alerts2_end_quack_v', 'alerts2_start_quack_v']);
  });
});

describe('channels and a sync running at the same time', () => {
  it('a sound picked (and previewed) while a sync is still booking keeps its channel for the next sync', async (t) => {
    const { w, N } = await setup(t);
    // Hold the first sync of the process while it books (on a phone, 150 native calls take a while).
    let release = () => {};
    w.notif.state.scheduleGate = new Promise<void>((r) => (release = r));
    const first = N.syncSchedule();
    for (let i = 0; i < 20 && w.notif.callsOf('scheduleNotificationAsync').length === 0; i++) await flush();
    assert.ok(w.notif.callsOf('scheduleNotificationAsync').length > 0, 'the sync is booking');

    // Meanwhile, in the sound picker: "Phone sound", previewed, which creates its channel.
    const settings = await w.load('services/settings');
    settings.saveSettings({ startSound: 'phone' }, { sync: false });
    await N.previewMoment('start');
    assert.ok(w.notif.channel('alerts2_start_default_v'));

    w.notif.state.scheduleGate = null;
    release();
    await first;
    // Leaving the picker syncs with the new sound.
    await N.syncSchedule();
    const missing = [
      ...new Set(
        w.notif
          .scheduled()
          .map((r: { trigger: { channelId: string } }) => r.trigger.channelId)
          .filter((id: string) => !w.notif.channel(id)),
      ),
    ];
    // The first sync's pruneChannels must keep the channel the preview just created (or, if one
    // goes, ensureChannels must not still think it exists). Otherwise the next sync books every
    // reminder on a deleted channel and Android posts them on its fallback channel: wrong sound.
    assert.deepEqual(missing, [], 'every booked reminder is on a channel that exists');
  });
});

describe('remindersBlocked', () => {
  it('Android: true when the reminder channel was turned off in the phone settings', async (t) => {
    const { w, N } = await setup(t);
    assert.equal(await N.remindersBlocked(), false);
    w.notif.setChannelImportance('alerts2_start_quack_v', w.N.AndroidImportance.NONE);
    assert.equal(await N.remindersBlocked(), true);
  });

  it('Android: a lowered (but not off) importance is not blocked', async (t) => {
    const { w, N } = await setup(t);
    await N.ensureChannels();
    w.notif.setChannelImportance('alerts2_start_quack_v', w.N.AndroidImportance.LOW);
    assert.equal(await N.remindersBlocked(), false);
  });

  it('iOS: never', async (t) => {
    const { N } = await setup(t, {}, { os: 'ios' });
    assert.equal(await N.remindersBlocked(), false);
  });
});
