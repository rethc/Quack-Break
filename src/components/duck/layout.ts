// Made by scripts/duck-from-sheet/sprites.cjs from the sprite sheets in assets/duck/source.
// Run `npm run duck:from-sheet` to remake it, rather than editing it by hand.

/** Where the head is in each frame compared with the standing duck, as a share of the picture's size. The things the duck wears follow it. */
export const headOffset = {
  stand: [0, 0],
  'walk-1': [0.005, 0.0117],
  'walk-2': [-0.0017, 0],
  'walk-3': [-0.0017, -0.0083],
  'walk-4': [-0.0017, 0],
  talk: [0, 0],
  wave: [-0.0017, 0],
  cheer: [-0.0017, 0],
  happy: [0, 0],
  sit: [0.01, 0.03],
  sleepy: [0.0033, 0.0333],
  content: [-0.0167, 0.0017],
  dozing: [0, 0.0367],
  asleep: [0.0017, 0.0633],
  blink: [0, 0],
} as const;

/** The middle of the standing duck's beak, as a share of the picture's width to the right of its centre. The speech bubble's tail points at it. */
export const BEAK_FROM_CENTRE = 0.1167;
