// Fake 'expo-haptics': records every call.

export const ImpactFeedbackStyle = { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' };
export const NotificationFeedbackType = { Success: 'success', Warning: 'warning', Error: 'error' };

/** { fn, arg } in call order. */
export const calls = [];

export async function impactAsync(style = ImpactFeedbackStyle.Medium) {
  calls.push({ fn: 'impactAsync', arg: style });
}

export async function notificationAsync(type = NotificationFeedbackType.Success) {
  calls.push({ fn: 'notificationAsync', arg: type });
}

export async function selectionAsync() {
  calls.push({ fn: 'selectionAsync' });
}
