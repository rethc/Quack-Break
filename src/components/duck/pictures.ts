// The duck's pictures. Each frame is the whole duck in one pose, cut from the sprite sheets in
// assets/duck/source by `npm run duck:from-sheet`. All frames are the same square size and stand on
// the same spot, so swapping one for another animates the duck. See assets/duck/README.md.
import type { ImageSourcePropType } from 'react-native';

import type { ItemId } from '@/core/pond';

export const duckFrames = {
  stand: require('../../../assets/duck/stand.png'),
  blink: require('../../../assets/duck/blink.png'),
  'walk-1': require('../../../assets/duck/walk-1.png'),
  'walk-2': require('../../../assets/duck/walk-2.png'),
  'walk-3': require('../../../assets/duck/walk-3.png'),
  'walk-4': require('../../../assets/duck/walk-4.png'),
  talk: require('../../../assets/duck/talk.png'),
  wave: require('../../../assets/duck/wave.png'),
  cheer: require('../../../assets/duck/cheer.png'),
  happy: require('../../../assets/duck/happy.png'),
  sit: require('../../../assets/duck/sit.png'),
  sleepy: require('../../../assets/duck/sleepy.png'),
  content: require('../../../assets/duck/content.png'),
  dozing: require('../../../assets/duck/dozing.png'),
  asleep: require('../../../assets/duck/asleep.png'),
} satisfies Record<string, ImageSourcePropType>;

export type FrameName = keyof typeof duckFrames;

/** The things to wear, placed on the standing duck. They move with the head from frame to frame. */
export const wearPictures: Partial<Record<ItemId, ImageSourcePropType>> = {
  beanie: require('../../../assets/duck/beanie.png'),
  bow: require('../../../assets/duck/bow.png'),
  scarf: require('../../../assets/duck/scarf.png'),
  glasses: require('../../../assets/duck/glasses.png'),
};

/** The wearables' own icons, for the pond screen and the unlock card. */
export const wearIcons: Partial<Record<ItemId, ImageSourcePropType>> = {
  beanie: require('../../../assets/duck/icon-beanie.png'),
  bow: require('../../../assets/duck/icon-bow.png'),
  scarf: require('../../../assets/duck/icon-scarf.png'),
  glasses: require('../../../assets/duck/icon-glasses.png'),
};
