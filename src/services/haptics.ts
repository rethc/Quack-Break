import * as Haptics from 'expo-haptics';

import { getData } from './storage';

const enabled = () => getData().settings.haptics;
const ignore = () => {};

export const haptic = {
  tap() {
    if (enabled()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(ignore);
  },
  success() {
    if (enabled()) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(ignore);
  },
  soft() {
    if (enabled()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(ignore);
  },
};
