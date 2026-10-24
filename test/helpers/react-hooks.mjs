// Call a hook outside a component, to reach the store's subscribe function through useData.
// Real React is loaded; this installs a minimal hook dispatcher for the duration of one call
// (the same slot a renderer fills while rendering). Only useSyncExternalStore is provided.
import React from 'react';

const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

/**
 * Runs `hook()` and returns its value plus the subscribe/getSnapshot pair it handed to
 * useSyncExternalStore.
 */
export function callHook(hook) {
  if (!internals || !('H' in internals)) throw new Error('React internals changed: update test/helpers/react-hooks.mjs');
  const previous = internals.H;
  let store = null;
  internals.H = {
    useSyncExternalStore(subscribe, getSnapshot) {
      store = { subscribe, getSnapshot };
      return getSnapshot();
    },
  };
  try {
    const value = hook();
    return { value, ...store };
  } finally {
    internals.H = previous;
  }
}
