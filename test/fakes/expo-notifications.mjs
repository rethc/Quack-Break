// Fake 'expo-notifications' (SDK 58): an in-memory scheduler, channels, categories and permissions,
// with the platform differences the real library has (channels are Android-only, exact alarms
// are always granted on iOS) and the Android rule that a channel's sound, vibration and
// importance can't change after it is created. Test helpers are on `fake`.
import { Platform } from './react-native.mjs';

// Enums, with the real values.
export const AndroidImportance = { UNKNOWN: 0, UNSPECIFIED: 1, NONE: 2, MIN: 3, LOW: 4, DEFAULT: 5, HIGH: 6, MAX: 7 };
export const AndroidNotificationVisibility = { UNKNOWN: 0, PUBLIC: 1, PRIVATE: 2, SECRET: 3 };
export const IosAuthorizationStatus = { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 };
export const PermissionStatus = { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' };
export const SchedulableTriggerInputTypes = {
  CALENDAR: 'calendar',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  DATE: 'date',
  TIME_INTERVAL: 'timeInterval',
};
export const BackgroundNotificationTaskResult = { NewData: 0, NoData: 1, Failed: 2 };
export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

const granted = () => ({ status: 'granted', granted: true, canAskAgain: true, expires: 'never' });
const denied = () => ({ status: 'denied', granted: false, canAskAgain: true, expires: 'never' });

const state = {
  /** identifier -> { identifier, content, trigger } (trigger as the native side stores it). */
  scheduled: new Map(),
  /** Notifications posted at once (null or channel-only trigger). */
  presented: [],
  /** DATE triggers already in the past: Android drops these silently. */
  droppedPast: [],
  /** Scheduled notifications whose time came (see deliverDue). */
  delivered: [],
  /** iOS: ids dropped because more than 64 were pending. */
  iosLimitDropped: [],
  /** A promise every scheduleNotificationAsync call waits for, to hold a sync mid-way. */
  scheduleGate: null,
  /** id -> channel. */
  channels: new Map(),
  /** Channels deleted, by id: Android restores their settings if the id is created again. */
  deletedChannels: new Map(),
  categories: new Map(),
  permission: granted(),
  /** What requestPermissionsAsync resolves to (and then becomes the permission). */
  requestResult: granted(),
  exact: { granted: true },
  exactThrows: null,
  requestExactResult: { granted: true },
  handler: null,
  dismissed: [],
  /** Set to an Error to make dismissNotificationAsync reject. */
  dismissError: null,
  dismissedAll: 0,
  registeredTasks: [],
  registerTaskError: null,
  /** Every call: { n, fn, args }. */
  calls: [],
  /** (request) => Error | undefined; an Error rejects that scheduleNotificationAsync call. */
  scheduleFailure: null,
  /** (id) => Error | undefined. */
  cancelFailure: null,
  /** (id) => Error | undefined. */
  deleteChannelFailure: null,
  getAllFailure: null,
  lastResponse: null,
  responseListeners: new Set(),
};

let seq = 0;
const record = (fn, ...args) => state.calls.push({ n: ++seq, fn, args: structuredClone(args) });
const clone = (v) => (v === undefined ? undefined : structuredClone(v));
const isAndroid = () => Platform.OS === 'android';

// ---------------------------------------------------------------------------------------------
// Handler, presenting, responses

export function setNotificationHandler(handler) {
  record('setNotificationHandler');
  state.handler = handler;
}

export async function dismissNotificationAsync(id) {
  record('dismissNotificationAsync', id);
  if (state.dismissError) throw state.dismissError;
  state.dismissed.push(id);
}

export async function dismissAllNotificationsAsync() {
  record('dismissAllNotificationsAsync');
  state.dismissedAll++;
}

export async function getPresentedNotificationsAsync() {
  return clone(state.presented);
}

export function getLastNotificationResponse() {
  return state.lastResponse;
}

export function clearLastNotificationResponse() {
  state.lastResponse = null;
}

export function addNotificationResponseReceivedListener(listener) {
  state.responseListeners.add(listener);
  return { remove: () => state.responseListeners.delete(listener) };
}

export function addNotificationReceivedListener() {
  return { remove() {} };
}

// ---------------------------------------------------------------------------------------------
// Permissions

export async function getPermissionsAsync() {
  record('getPermissionsAsync');
  return clone(state.permission);
}

export async function requestPermissionsAsync(permissions) {
  record('requestPermissionsAsync', permissions);
  state.permission = clone(state.requestResult);
  return clone(state.permission);
}

export async function getExactAlarmPermissionsAsync() {
  record('getExactAlarmPermissionsAsync');
  if (!isAndroid()) return granted();
  if (state.exactThrows) throw state.exactThrows;
  return state.exact.granted ? granted() : denied();
}

export async function requestExactAlarmPermissionsAsync() {
  record('requestExactAlarmPermissionsAsync');
  if (!isAndroid()) return granted();
  if (state.exactThrows) throw state.exactThrows;
  state.exact = { granted: state.requestExactResult.granted };
  return state.exact.granted ? granted() : denied();
}

// ---------------------------------------------------------------------------------------------
// Channels (Android only; the real functions do nothing elsewhere)

export async function setNotificationChannelAsync(id, input) {
  record('setNotificationChannelAsync', id, input);
  if (!isAndroid()) return null;
  const existing = state.channels.get(id) ?? state.deletedChannels.get(id);
  state.deletedChannels.delete(id);
  const channel = existing
    ? // After creation only the name and description can change.
      { ...existing, name: input.name ?? existing.name, description: input.description ?? existing.description }
    : {
        id,
        name: input.name,
        description: input.description ?? null,
        importance: input.importance,
        // The real channel reports 'default' | 'custom' | null; keep the input too, for tests.
        sound: !('sound' in input) ? 'default' : input.sound === null ? null : 'custom',
        soundFile: 'sound' in input ? input.sound : undefined,
        hasSoundKey: 'sound' in input,
        enableVibrate: !!input.enableVibrate,
        vibrationPattern: input.vibrationPattern ?? null,
        lockscreenVisibility: input.lockscreenVisibility,
        showBadge: input.showBadge,
      };
  state.channels.set(id, channel);
  return clone(channel);
}

export async function getNotificationChannelsAsync() {
  record('getNotificationChannelsAsync');
  if (!isAndroid()) return [];
  return [...state.channels.values()].map(clone);
}

export async function getNotificationChannelAsync(id) {
  record('getNotificationChannelAsync', id);
  if (!isAndroid()) return null;
  return clone(state.channels.get(id) ?? null);
}

export async function deleteNotificationChannelAsync(id) {
  record('deleteNotificationChannelAsync', id);
  if (!isAndroid()) return;
  const error = state.deleteChannelFailure?.(id);
  if (error) throw error;
  const c = state.channels.get(id);
  if (c) {
    state.deletedChannels.set(id, c);
    state.channels.delete(id);
  }
}

// ---------------------------------------------------------------------------------------------
// Categories

export async function setNotificationCategoryAsync(identifier, actions, options) {
  record('setNotificationCategoryAsync', identifier, actions, options);
  const category = { identifier, actions: clone(actions), options: clone(options) };
  state.categories.set(identifier, category);
  return clone(category);
}

export async function getNotificationCategoriesAsync() {
  return [...state.categories.values()].map(clone);
}

// ---------------------------------------------------------------------------------------------
// Scheduling

/** The same checks and conversion as expo-notifications' parseTrigger. */
function parseTrigger(t) {
  if (t === null) return null;
  if (t === undefined) {
    throw new TypeError('Encountered an `undefined` notification trigger. Pass `null` to trigger it now.');
  }
  if (typeof t !== 'object' || !('type' in t || 'channelId' in t)) {
    throw new TypeError('The `trigger` object you provided is invalid. It needs a `type` or `channelId` entry.');
  }
  if (t.type === SchedulableTriggerInputTypes.DATE) {
    const timestamp = t.date instanceof Date ? t.date.getTime() : t.date;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) throw new TypeError('Invalid date trigger');
    return { type: 'date', timestamp, ...(t.channelId && { channelId: t.channelId }) };
  }
  if (t.type === SchedulableTriggerInputTypes.TIME_INTERVAL) {
    if (typeof t.seconds !== 'number' || t.seconds <= 0) throw new TypeError('Invalid time interval trigger');
    return { type: 'timeInterval', seconds: t.seconds, repeats: !!t.repeats, ...(t.channelId && { channelId: t.channelId }) };
  }
  if (t.type) return { ...t };
  // Channel-only: post now, on that channel (Android). Other platforms: now.
  return isAndroid() ? { type: 'channel', channelId: t.channelId } : null;
}

let autoId = 0;
const when = (entry) =>
  entry.trigger?.type === 'date' ? entry.trigger.timestamp : entry.trigger?.type === 'timeInterval' ? Date.now() + entry.trigger.seconds * 1000 : 0;

/** iOS keeps at most this many pending notifications, silently dropping the latest. */
const IOS_PENDING_LIMIT = 64;

export async function scheduleNotificationAsync(request) {
  record('scheduleNotificationAsync', request);
  if (state.scheduleGate) await state.scheduleGate;
  const error = state.scheduleFailure?.(request);
  if (error) throw error;
  const identifier = request.identifier ?? `auto-${++autoId}`;
  const trigger = parseTrigger(request.trigger);
  const entry = { identifier, content: clone(request.content), trigger };
  if (trigger === null || trigger.type === 'channel') {
    state.presented.push(entry);
  } else if (trigger.type === 'date' && trigger.timestamp <= Date.now()) {
    state.droppedPast.push(entry);
  } else {
    // Same identifier: the new one replaces the old.
    state.scheduled.delete(identifier);
    state.scheduled.set(identifier, entry);
    if (!isAndroid() && state.scheduled.size > IOS_PENDING_LIMIT) {
      const latest = [...state.scheduled.values()].sort((a, b) => when(b) - when(a))[0];
      state.scheduled.delete(latest.identifier);
      state.iosLimitDropped.push(latest.identifier);
    }
  }
  return identifier;
}

/** Notifications whose time has come leave the scheduled list, as on a real phone. */
function deliverDue() {
  for (const [id, entry] of state.scheduled) {
    if (entry.trigger?.type === 'date' && entry.trigger.timestamp <= Date.now()) {
      state.scheduled.delete(id);
      state.delivered.push(entry);
    }
  }
}

export async function getAllScheduledNotificationsAsync() {
  record('getAllScheduledNotificationsAsync');
  if (state.getAllFailure) throw state.getAllFailure;
  deliverDue();
  return [...state.scheduled.values()].map(clone);
}

export async function cancelScheduledNotificationAsync(id) {
  record('cancelScheduledNotificationAsync', id);
  const error = state.cancelFailure?.(id);
  if (error) throw error;
  state.scheduled.delete(id);
}

export async function cancelAllScheduledNotificationsAsync() {
  record('cancelAllScheduledNotificationsAsync');
  state.scheduled.clear();
}

// ---------------------------------------------------------------------------------------------
// Background tasks

export async function registerTaskAsync(name) {
  record('registerTaskAsync', name);
  if (state.registerTaskError) throw state.registerTaskError;
  state.registeredTasks.push(name);
  return null;
}

export async function unregisterTaskAsync(name) {
  state.registeredTasks = state.registeredTasks.filter((t) => t !== name);
  return null;
}

// ---------------------------------------------------------------------------------------------
// Test helpers

export const fake = {
  state,
  /** Calls of one function, as their argument lists. */
  callsOf: (fn) => state.calls.filter((c) => c.fn === fn).map((c) => c.args),
  /** Sequence numbers of the calls of one function, to check ordering. */
  seqOf: (fn) => state.calls.filter((c) => c.fn === fn).map((c) => c.n),
  clearCalls: () => void (state.calls.length = 0),
  scheduledIds: () => [...state.scheduled.keys()],
  scheduled: () => [...state.scheduled.values()],
  /** Move notifications whose time has passed out of the scheduled list. */
  deliverDue,
  channelIds: () => [...state.channels.keys()].sort(),
  channel: (id) => state.channels.get(id),
  /** Permission as getPermissionsAsync reports it. iosStatus is an IosAuthorizationStatus. */
  setPermission(isGranted, iosStatus) {
    state.permission = { ...(isGranted ? granted() : denied()) };
    if (iosStatus !== undefined) state.permission.ios = { status: iosStatus };
  },
  setRequestResult(isGranted, iosStatus) {
    state.requestResult = { ...(isGranted ? granted() : denied()) };
    if (iosStatus !== undefined) state.requestResult.ios = { status: iosStatus };
  },
  setExactAlarms(isGranted) {
    state.exact = { granted: isGranted };
  },
  /** The user turned a channel off (or changed its importance) in the phone's settings. */
  setChannelImportance(id, importance) {
    const c = state.channels.get(id);
    if (!c) throw new Error(`No channel ${id}`);
    c.importance = importance;
  },
  /** A channel left over from an older build. */
  addChannel(id, extra = {}) {
    state.channels.set(id, { id, name: id, importance: AndroidImportance.HIGH, ...extra });
  },
  /** Book a notification directly, as an older run of the app would have. */
  addScheduled(identifier, at, content = {}) {
    state.scheduled.set(identifier, { identifier, content, trigger: { type: 'date', timestamp: at } });
  },
  /** Run the installed handler for a notification, as expo-notifications does in the foreground. */
  async handle(notification) {
    if (!state.handler) throw new Error('No notification handler installed');
    return state.handler.handleNotification(notification);
  },
};
