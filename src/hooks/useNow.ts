import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * The current time, re-rendering only at `nextAt` (when the display would change),
 * and at most once a minute otherwise. Pauses while the app is in the background.
 */
export function useNow(nextAt: (now: number) => number | null): number {
  const [now, setNow] = useState(Date.now);
  const target = nextAt(now);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (AppState.currentState === 'active') {
      const wait = target === null ? 60_000 : Math.min(Math.max(target - Date.now(), 50), 60_000);
      timer = setTimeout(() => setNow(Date.now()), wait);
    }
    const sub = AppState.addEventListener('change', (s) => {
      clearTimeout(timer);
      if (s === 'active') setNow(Date.now());
    });
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
  }, [now, target]);

  return now;
}
