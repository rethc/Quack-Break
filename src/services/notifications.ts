// Local notifications: channels, action buttons, and keeping the schedule in sync.
// Nothing runs on a timer in the background. We book notifications ahead and
// re-sync whenever the app opens, settings change, or a break starts/ends.
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { planNotifications } from '@/core/notificationPlan';
import { MINUTE } from '@/core/schedule';
import { soundFile, vibrateOf, type Moment } from '@/core/sounds';
import { rememberHandled, snooze, startBreak } from '@/core/transitions';

import { haptic } from './haptics';
import { getData, updateData } from './storage';
import { updateTimer } from './timer';

export const CATEGORY_DUE = 'break_due';
export const ACTION_START = 'start_break';
export const ACTION_SNOOZE = 'snooze';

const CHANNEL_PREFIX = 'breaks_';
const TEST_PREFIX = 'test_';
/** Ignore taps on notifications older than this (e.g. found in the tray hours later). */
const STALE_MS = 30 * MINUTE;

type Kind = 'due' | 'over' | 'test' | 'preview';
const KINDS: readonly string[] = ['due', 'over', 'test', 'preview'];

/**
 * Which of our notifications this is. Background tasks get the data as a JSON string
 * (`dataString`) instead of `data`, so check both, then fall back to the id prefix.
 */
function kindOf(n: Notifications.Notification): Kind | undefined {
  const content = n.request.content as Notifications.NotificationContent & { dataString?: unknown };
  let kind: unknown = content.data?.kind;
  if (kind === undefined && typeof content.dataString === 'string') {
    try {
      kind = (JSON.parse(content.dataString) as { kind?: unknown } | null)?.kind;
    } catch {
      // Not JSON; fall through to the id.
    }
  }
  kind ??= n.request.identifier.split('_')[0];
  return typeof kind === 'string' && KINDS.includes(kind) ? (kind as Kind) : undefined;
}

/** On screen, the app already shows the break state, so we only quack and/or buzz. */
export function installNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const kind = kindOf(n);
      if (kind === 'preview') {
        return { shouldShowBanner: false, shouldShowList: false, shouldPlaySound: true, shouldSetBadge: false };
      }
      const quiet = kind === 'due' || kind === 'over';
      // A hidden notification doesn't use the channel's vibration, so buzz here.
      if (quiet) haptic.alert(momentOf(kind));
      return {
        shouldShowBanner: !quiet,
        shouldShowList: !quiet,
        shouldPlaySound: fileFor(momentOf(kind)) !== null,
        shouldSetBadge: false,
      };
    },
  });
}

const MOMENTS: readonly Moment[] = ['start', 'end'];
const CHANNEL_TEXT: Record<Moment, { name: string; description: string }> = {
  start: { name: 'Break reminders', description: "When it's time for an eye break" },
  end: { name: 'Break over', description: 'When your break time is up' },
};
const VIBRATION = [0, 120, 90, 160];

const momentOf = (kind: Kind | undefined): Moment => (kind === 'over' ? 'end' : 'start');
const fileFor = (m: Moment) => soundFile(m, getData().settings);
const soundForChannel = (file: string | null): { sound?: string | null } =>
  file === 'default' ? {} : { sound: file };
const contentSound = (m: Moment) => fileFor(m) ?? false;
// expo-notifications marks a notification SILENT unless it has a sound or its own vibration
// pattern, even when its channel vibrates. So vibration needs the pattern here too.
const contentVibrate = (m: Moment) => (vibrateOf(m, getData().settings) ? VIBRATION : undefined);
const channelIdFor = (m: Moment) => {
  const s = getData().settings;
  const file = soundFile(m, s);
  return `${CHANNEL_PREFIX}${m}_${file ? file.replace('.wav', '') : 'none'}_${vibrateOf(m, s) ? 'v' : 'n'}`;
};


// Android channels can't change sound/vibration after creation,
// so each moment + sound + vibration gets its own channel id and unused ones are deleted.
let readyChannels: string | null = null;

export async function ensureChannels(): Promise<Record<Moment, string> | undefined> {
  if (Platform.OS !== 'android') return undefined;
  const s = getData().settings;
  const ids: Record<Moment, string> = { start: channelIdFor('start'), end: channelIdFor('end') };
  const key = `${ids.start}|${ids.end}`;
  if (readyChannels === key) return ids;
  for (const m of MOMENTS) {
    const vibrate = vibrateOf(m, s);
    await Notifications.setNotificationChannelAsync(ids[m], {
      ...CHANNEL_TEXT[m],
      importance: Notifications.AndroidImportance.HIGH,
      // No sound key means the phone's own notification sound ("Phone sound");
      // null means silent. "default" isn't accepted for channels.
      ...soundForChannel(soundFile(m, s)),
      enableVibrate: vibrate,
      vibrationPattern: vibrate ? VIBRATION : undefined,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      showBadge: false,
    });
  }
  const keep = new Set(Object.values(ids));
  const channels = await Notifications.getNotificationChannelsAsync();
  await Promise.all(
    channels
      .filter((c) => c.id.startsWith(CHANNEL_PREFIX) && !keep.has(c.id))
      .map((c) => Notifications.deleteNotificationChannelAsync(c.id)),
  );
  readyChannels = key;
  return ids;
}

let readyCategory: number | null = null;

async function ensureCategory() {
  const { snoozeMin } = getData().settings;
  if (readyCategory === snoozeMin) return;
  await Notifications.setNotificationCategoryAsync(CATEGORY_DUE, [
    // Android: the break runs in the tray timer, so there's no need to open the app.
    { identifier: ACTION_START, buttonTitle: 'Start', options: { opensAppToForeground: Platform.OS !== 'android' } },
    { identifier: ACTION_SNOOZE, buttonTitle: `Snooze ${snoozeMin} min`, options: { opensAppToForeground: false } },
  ]);
  readyCategory = snoozeMin;
}

export async function canNotify(): Promise<boolean> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

export async function requestNotificationPermission(): Promise<boolean> {
  // Android 13+ only shows the prompt once a channel exists.
  await ensureChannels();
  const p = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

/** Android 12+: exact alarms keep reminders on time while the phone is idle. */
export const needsExactAlarmPermission = Platform.OS === 'android' && Number(Platform.Version) >= 31;

export async function hasExactAlarms(): Promise<boolean> {
  if (!needsExactAlarmPermission) return true;
  try {
    return (await Notifications.getExactAlarmPermissionsAsync()).granted;
  } catch {
    return true;
  }
}

export async function requestExactAlarms(): Promise<boolean> {
  if (!needsExactAlarmPermission) return true;
  try {
    return (await Notifications.requestExactAlarmPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

let chain: Promise<void> = Promise.resolve();

/** Make the booked notifications match the plan. Calls run one at a time. */
export function syncSchedule(): Promise<void> {
  chain = chain.then(doSync).catch((e) => console.warn('Could not update reminders', e));
  return chain;
}

/**
 * Android drops an app's alarms on force stop and when exact alarms are revoked, but
 * expo-notifications still lists them as scheduled (it only re-arms after a reboot or update).
 * Both cases restart our process, so the first sync in a process re-books everything,
 * and so does a change in the exact-alarm permission (to switch between exact and inexact).
 */
let armedWithExact: boolean | null = null;

async function doSync() {
  const data = getData();
  if (!data.onboarded || !(await canNotify())) {
    updateTimer(null);
    return;
  }
  const exact = await hasExactAlarms();
  const rearm = Platform.OS === 'android' && armedWithExact !== exact;
  const channels = await ensureChannels();
  await ensureCategory();

  const want = planNotifications(data, Date.now());
  const wantIds = new Set(want.map((n) => n.id));
  const existing = await Notifications.getAllScheduledNotificationsAsync();
  const existingIds = new Set(existing.map((r) => r.identifier));

  await Promise.all(
    existing
      .filter((r) => !wantIds.has(r.identifier) && !r.identifier.startsWith(TEST_PREFIX))
      .map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier)),
  );

  await Promise.all(
    want
      .filter((n) => rearm || !existingIds.has(n.id))
      .map((n) =>
        Notifications.scheduleNotificationAsync({
          identifier: n.id,
          content: {
            title: n.title,
            body: n.body,
            data: { kind: n.kind },
            sound: contentSound(momentOf(n.kind)),
            vibrate: contentVibrate(momentOf(n.kind)),
            categoryIdentifier: n.kind === 'due' ? CATEGORY_DUE : undefined,
            threadIdentifier: 'quack',
            color: '#F5B935',
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: n.at,
            channelId: channels?.[momentOf(n.kind)],
          },
        }),
      ),
  );
  armedWithExact = exact;
  updateTimer(data, want);
}

/** A reminder in a few seconds, with the real buttons, for checking things work. */
export async function sendTestReminder(seconds = 10) {
  const channels = await ensureChannels();
  await ensureCategory();
  await Notifications.scheduleNotificationAsync({
    identifier: `${TEST_PREFIX}${Date.now()}`,
    content: {
      title: 'Test reminder 🦆',
      body: 'This is what break reminders look like.',
      data: { kind: 'test' },
      sound: contentSound('start'),
      vibrate: contentVibrate('start'),
      categoryIdentifier: CATEGORY_DUE,
      color: '#F5B935',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds,
      channelId: channels?.start,
    },
  });
}

/**
 * Play a moment's current sound now, for previews in Settings. Goes through the same path as a
 * reminder arriving while the app is open, so it needs no audio library and follows the phone's
 * volume. Android plays the channel's sound (not the content's), so the moment's channel is
 * brought up to date first and the preview is posted on it.
 */
export async function previewMoment(m: Moment) {
  const file = fileFor(m);
  if (!file) return;
  const channels = await ensureChannels();
  await Notifications.scheduleNotificationAsync({
    identifier: `preview_${Date.now()}`,
    content: { title: 'Preview', data: { kind: 'preview' }, sound: file },
    trigger: channels ? { channelId: channels[m] } : null,
  });
}

/** Android: open the system settings for a moment's channel, where any installed tone can be picked. */
export async function openPhoneSoundPicker(m: Moment) {
  const ids = await ensureChannels();
  if (!ids) return;
  const pkg = Constants.expoConfig?.android?.package ?? 'com.chesd.quackbreak';
  try {
    await Linking.sendIntent('android.settings.CHANNEL_NOTIFICATION_SETTINGS', [
      { key: 'android.provider.extra.APP_PACKAGE', value: pkg },
      { key: 'android.provider.extra.CHANNEL_ID', value: ids[m] },
    ]);
  } catch {
    await Linking.openSettings();
  }
}

export type ResponseOutcome = 'break' | 'home' | 'none';

/**
 * Apply a tap on a notification or one of its buttons. Each response is applied once,
 * even if it arrives through several paths (listener, cold start, background task).
 * The caller should navigate based on the result and then call syncSchedule().
 */
export function applyResponse(r: Notifications.NotificationResponse): ResponseOutcome {
  const req = r.notification.request;
  const key = `${req.identifier}|${r.actionIdentifier}`;
  if (getData().handled.includes(key)) return 'none';
  updateData((d) => rememberHandled(d, key));
  Notifications.dismissNotificationAsync(req.identifier).catch(() => {});

  const now = Date.now();
  // Some platforms report seconds instead of milliseconds.
  const sentAt = r.notification.date < 1e12 ? r.notification.date * 1000 : r.notification.date;
  const fresh = now - sentAt < STALE_MS;
  const kind = kindOf(r.notification);

  if (kind === 'due' || kind === 'test') {
    if (r.actionIdentifier === ACTION_SNOOZE) {
      if (fresh) updateData((d) => snooze(d, now));
      return 'none';
    }
    if (fresh) {
      updateData((d) => startBreak(d, now));
      return 'break';
    }
  }
  return 'home';
}
