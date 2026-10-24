// Fake 'react-native': only what the services use. Set Platform.OS / Version before loading a
// service (some read them once, at import), e.g. through world({ os: 'ios' }).

export const Platform = {
  OS: 'android',
  /** Android API level (a number), or the iOS version (a string). */
  Version: 35,
  select(spec) {
    if (Object.hasOwn(spec, Platform.OS)) return spec[Platform.OS];
    if (Object.hasOwn(spec, 'native')) return spec.native;
    return spec.default;
  },
};

export const Vibration = {
  /** Every pattern passed to vibrate(), in order. */
  calls: [],
  vibrate(pattern) {
    Vibration.calls.push(pattern);
  },
  cancel() {},
};

export const Linking = {
  /** { fn: 'sendIntent' | 'openSettings' | 'openURL', args } in call order. */
  calls: [],
  /** Set to an Error to make sendIntent reject (e.g. the settings screen doesn't exist). */
  sendIntentError: null,
  async sendIntent(action, extras) {
    Linking.calls.push({ fn: 'sendIntent', args: [action, extras] });
    if (Linking.sendIntentError) throw Linking.sendIntentError;
  },
  async openSettings() {
    Linking.calls.push({ fn: 'openSettings', args: [] });
  },
  async openURL(url) {
    Linking.calls.push({ fn: 'openURL', args: [url] });
  },
};

const appStateListeners = new Set();

export const AppState = {
  currentState: 'active',
  addEventListener(event, listener) {
    const entry = { event, listener };
    appStateListeners.add(entry);
    return { remove: () => appStateListeners.delete(entry) };
  },
  /** Test helper: move the app to a state and tell listeners. */
  __set(state) {
    AppState.currentState = state;
    for (const { event, listener } of appStateListeners) if (event === 'change') listener(state);
  },
};

export default { Platform, Vibration, Linking, AppState };
