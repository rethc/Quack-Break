import * as Haptics from 'expo-haptics';
import { Platform, Vibration } from 'react-native';

import { vibrateOf } from '@/core/sounds';

import { getData } from './storage';

const taps = () => getData().settings.haptics;
const ignore = () => {};

/** Same rhythm as the notification channel: buzz, pause, longer buzz. */
const ALERT_PATTERN = [0, 120, 90, 160];
let lastAlertAt = 0;

/**
 * A real vibration, strong enough to notice while looking away. Haptic "success" is only
 * a faint tick on Android (two 40 ms pulses at about 20% strength), so use the vibrator there.
 */
function alertBuzz() {
  if (Platform.OS === 'android') Vibration.vibrate(ALERT_PATTERN);
  else Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore);
}

export const haptic = {
  tap() {
    if (taps()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(ignore);
  },
  soft() {
    if (taps()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(ignore);
  },
  success() {
    if (taps()) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore);
  },
  /**
   * A reminder arrived or a break ended while the app is open. Follows the matching
   * Sound and vibration setting. Several callers can fire for the same moment, so
   * repeats within 2 seconds are dropped.
   */
  alert(moment: 'start' | 'end') {
    if (!vibrateOf(moment, getData().settings)) return;
    const now = Date.now();
    if (now - lastAlertAt < 2000) return;
    lastAlertAt = now;
    alertBuzz();
  },
  /** A sample when picking Quack or Vibrate in Settings. */
  preview() {
    alertBuzz();
  },
};
