// What the duck says. The duck talks in speech bubbles and celebrations;
// notifications and the rest of the app stay plain.

export const reminderTitles = ['Break time'];

export const reminderBodies = (sec: number) => [`Look far away for ${sec} seconds.`];

export const breakOverTitles = ['Break over'];

export const breakOverBodies = ['Back to it.'];

export const breakLines = [
  "Look out the window. I'll wait.",
  'Find something about 20 feet away. A tree, a cloud, a far wall.',
  'Let your eyes go soft and far.',
  'Blink slowly, like a sleepy duck.',
  'Somewhere out there is a pond. Look for it.',
  "Far away things only. I've got the clock.",
];

export const doneLines = [
  'Quack! Eyes refreshed.',
  "That's the stuff. Back to it!",
  'Lovely looking. Your eyes say thanks.',
  'Eggs-cellent break.',
  'Happy flap! See you in a bit.',
];

export const skipLines = [
  'No worries. Next time! 🤷',
  "Fair enough. I'll be around.",
  "Skipping is fine. I'm a very chill duck.",
  "All good. I'll paddle back later.",
];

export const waitingLines = [
  "Paddling around until your next break.",
  "I'll quack when it's time.",
  'Keep going, I have the clock.',
  'Just floating. Nothing to see here.',
];

export const dueLines = [
  'Break time! Got a few seconds?',
  'Psst. Eyes up, look far away?',
  'Ready when you are!',
];

export const pausedLines = ['Taking a breather. I’ll be here.', 'Reminders are off. Resume any time.'];

export const quietLines = ['Quiet hours. The duck is napping 💤', 'Shh. Duck asleep until morning 💤'];

/** Stable pick: the same seed always gives the same line. */
export function pick<T>(list: readonly T[], seed: number | string): T {
  const h = hash(String(seed));
  return list[h % list.length] as T;
}

/** Random pick that avoids repeating `avoid`. */
export function pickFresh<T>(list: readonly T[], avoid?: T): T {
  if (list.length < 2) return list[0] as T;
  let item = list[Math.floor(Math.random() * list.length)] as T;
  while (item === avoid) item = list[Math.floor(Math.random() * list.length)] as T;
  return item;
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
