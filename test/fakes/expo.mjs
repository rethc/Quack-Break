// Fake 'expo': requireOptionalNativeModule returns registered fakes, or null when missing
// (iOS, or an Android build made before the module existed). Set nativeModules.QuackTimer
// before modules/quack-timer loads; world() does that from its `timer` option.

/** A fake of the Android QuackTimer module (modules/quack-timer/android). */
export function makeQuackTimer({ sounds = true } = {}) {
  const listeners = new Set();
  const timer = {
    /** Every plan passed to setPlan, parsed. */
    plans: [],
    /** The raw JSON strings, to check it really is JSON. */
    rawPlans: [],
    /** Buttons pressed on the notification, returned (once) by takeActions. */
    pendingActions: [],
    /** Override what takeActions returns (a raw string), e.g. to test bad JSON. */
    rawActions: null,
    /** Set to an Error to make setPlan / takeActions throw. */
    setPlanError: null,
    takeActionsError: null,
    soundCalls: [],
    stopCalls: 0,
    setPlan(json) {
      if (typeof json !== 'string') throw new TypeError('setPlan takes a JSON string');
      if (timer.setPlanError) throw timer.setPlanError;
      timer.rawPlans.push(json);
      timer.plans.push(JSON.parse(json));
    },
    takeActions() {
      if (timer.takeActionsError) throw timer.takeActionsError;
      if (timer.rawActions !== null) {
        const raw = timer.rawActions;
        timer.rawActions = null;
        return raw;
      }
      const out = JSON.stringify(timer.pendingActions);
      timer.pendingActions = [];
      return out;
    },
    addListener(event, listener) {
      const entry = { event, listener };
      listeners.add(entry);
      return { remove: () => listeners.delete(entry) };
    },
    /** Test helper: the native side reporting a button press while JS runs. */
    __emit(event) {
      for (const e of listeners) if (e.event === event) e.listener();
    },
    get lastPlan() {
      return timer.plans[timer.plans.length - 1];
    },
  };
  if (sounds) {
    timer.playSound = (sound, channelId) => {
      timer.soundCalls.push({ sound, channelId });
    };
    timer.stopSound = () => {
      timer.stopCalls++;
    };
  }
  return timer;
}

/** Native modules by name. null or missing means "not in this build". */
export const nativeModules = {
  QuackTimer: makeQuackTimer(),
};

export const requested = [];

export function requireOptionalNativeModule(name) {
  requested.push(name);
  return nativeModules[name] ?? null;
}

export function requireNativeModule(name) {
  const m = nativeModules[name];
  if (!m) throw new Error(`Cannot find native module '${name}'`);
  return m;
}
