// Local notifications: channels, action buttons, and keeping the schedule in sync.
// Nothing runs on a timer in the background. We book notifications ahead and
// re-sync whenever the app opens, settings change, or a break starts/ends.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { planNotifications } from '@/core/notificationPlan';
import { MINUTE } from '@/core/schedule';
import { rememberHandled, snooze, startBreak } from '@/core/transitions';
import type { Settings } from '@/core/types';

import { getData, updateData } from './storage';

export const CATEGORY_DUE = 'break_due';
export const ACTION_START = 'start_break';
export const ACTION_SNOOZE = 'snooze';
export const QUACK_SOUND = 'quack.wav';

const CHANNEL_PREFIX = 'breaks_';
const TEST_PREFIX = 'test_';
/** Ignore taps on notifications older than this (e.g. found in the tray hours later). */
const STALE_MS = 30 * MINUTE;

type Kind = 'due' | 'over' | 'test';
const kindOf = (n: Notifications.Notification) => n.request.content.data?.kind as Kind | undefined;

/** On screen, the app already shows the break state, so we only play the quack. */
export function installNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      const sound = getData().settings.sound;
      const kind = kindOf(n);
      const quiet = kind === 'due' || kind === 'over';
      return {
        shouldShowBanner: !quiet,
        shouldShowList: !quiet,
        shouldPlaySound: sound,
        shouldSetBadge: false,
      };
    },
  });
}

// Android channels can't change sound/vibration after creation,
// so each combination gets its own id and the unused one is deleted.
const channelIdFor = (s: Settings) => `${CHANNEL_PREFIX}${s.sound ? 'q' : 's'}${s.haptics ? 'v' : 'n'}`;
let readyChannel: string | null = null;

export async function ensureChannel(): Promise<string | undefined> {
  if (Platform.OS !== 'android') return undefined;
  const s = getData().settings;
  const id = channelIdFor(s);
  if (readyChannel === id) return id;
  await Notifications.setNotificationChannelAsync(id, {
    name: 'Break reminders',
    description: 'Eye break reminders and the end-of-break quack',
    importance: Notifications.AndroidImportance.HIGH,
    sound: s.sound ? QUACK_SOUND : null,
    enableVibrate: s.haptics,
    vibrationPattern: s.haptics ? [0, 120, 90, 160] : undefined,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    showBadge: false,
  });
  const channels = await Notifications.getNotificationChannelsAsync();
  await Promise.all(
    channels
      .filter((c) => c.id.startsWith(CHANNEL_PREFIX) && c.id !== id)
      .map((c) => Notifications.deleteNotificationChannelAsync(c.id)),
  );
  readyChannel = id;
  return id;
}

let readyCategory: number | null = null;

async function ensureCategory() {
  const { snoozeMin } = getData().settings;
  if (readyCategory === snoozeMin) return;
  await Notifications.setNotificationCategoryAsync(CATEGORY_DUE, [
    { identifier: ACTION_START, buttonTitle: 'Start break', options: { opensAppToForeground: true } },
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
  await ensureChannel();
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

async function doSync() {
  const data = getData();
  if (!data.onboarded || !(await canNotify())) return;
  const channelId = await ensureChannel();
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

  const sound = data.settings.sound ? QUACK_SOUND : false;
  await Promise.all(
    want
      .filter((n) => !existingIds.has(n.id))
      .map((n) =>
        Notifications.scheduleNotificationAsync({
          identifier: n.id,
          content: {
            title: n.title,
            body: n.body,
            data: { kind: n.kind },
            sound,
            categoryIdentifier: n.kind === 'due' ? CATEGORY_DUE : undefined,
            threadIdentifier: 'quack',
            color: '#F5B935',
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: n.at, channelId },
        }),
      ),
  );
}

/** A reminder in a few seconds, with the real buttons, for checking things work. */
export async function sendTestReminder(seconds = 10) {
  const channelId = await ensureChannel();
  await ensureCategory();
  await Notifications.scheduleNotificationAsync({
    identifier: `${TEST_PREFIX}${Date.now()}`,
    content: {
      title: 'Quack! Test reminder 🦆',
      body: 'This is how break reminders look. Try the buttons!',
      data: { kind: 'test' },
      sound: getData().settings.sound ? QUACK_SOUND : false,
      categoryIdentifier: CATEGORY_DUE,
      color: '#F5B935',
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds, channelId },
  });
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
