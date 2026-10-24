// What the duck says, and the notification text. Plain English everywhere: short, friendly,
// no puns, no emoji. Every line fits the speech bubble on one or two lines (see copy tests).

export const reminderTitles = ['Break time'];

export const reminderBodies = (sec: number) => [`Look at something far away for ${sec} seconds.`];

export const breakOverTitles = ['Break over'];

export const breakOverBodies = ['Time to get back to it.'];

/** During a break. */
export const breakLines = [
  "Look out the window. I'll keep time.",
  'Find something about 20 feet (6 m) away.',
  'Relax your eyes and look into the distance.',
  'Blink slowly a few times.',
  'Look at the farthest thing you can see.',
];

/** When a break is done. */
export const doneLines = [
  'Well done. Your eyes had a rest.',
  'Nice work. Back to it.',
  'Good job. See you at the next break.',
  'All done. Your eyes will thank you.',
];

/** After skipping a break. */
export const skipLines = [
  "No problem. I'll remind you next time.",
  "That's fine. See you at the next break.",
  'Okay. Skipping now and then is fine.',
];

/** Waiting for the next break. */
export const waitingLines = [
  "I'll remind you when it's time.",
  "Keep going. I'm watching the clock.",
  'Nothing to do right now.',
  'Your next break is on its way.',
];

/** A break is due. */
export const dueLines = ['Time to rest your eyes.', 'Look up and find something far away.', 'Ready when you are.'];

/** Reminders stopped. */
export const pausedLines = ["I'll wait here until you resume.", 'No reminders until you turn them back on.'];

/** Quiet hours. */
export const quietLines = ["It's quiet hours. I'll remind you when they end.", 'No reminders until quiet hours end.'];

/** During a running break, on Home. */
export const breakRunningLines = ['Your break is still going.'];

/** After snoozing. */
export const snoozeLine = (min: number) => `Okay. I'll remind you in ${min} minutes.`;

/** Stable pick: the same seed always gives the same line. */
export function pick<T>(list: readonly T[], seed: number | string): T {
  const h = hash(String(seed));
  return list[h % list.length] as T;
}

/** Random pick that avoids repeating `avoid`. */
export function pickFresh<T>(list: readonly T[], avoid?: T): T {
  const choices = list.filter((item) => item !== avoid);
  if (choices.length === 0) return list[0] as T;
  return choices[Math.floor(Math.random() * choices.length)] as T;
}

/** FNV-1a, 32-bit. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
