// Drawings for the things the duck finds: tile art (64 x 64) for the pond screen and unlock card,
// and placed versions inside the pond scene (its 360 x 240 drawing). Plain SVG shapes, no images.
import { Image } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import type { ItemId } from '@/core/pond';
import { useTheme } from '@/theme';

import { wearIcons } from '../duck/pictures';

const FROG = '#7CC47F';
const FROG_DARK = '#3F7A44';
const PETAL = '#FFB3C7';
const PETAL_DEEP = '#FF8FA3';
const SUN = '#FFD54F';
const BARK = '#A0673A';
const WING = '#D3EEF8';
const WING_EDGE = '#7FC6E4';
const TEAL = '#2F6E8C';
const PAPER = '#FFFFFF';
const INK_SOFT = '#5E5677';
const SHELL = '#E9B52E';
const SHELL_LINE = '#A87A12';
const SNAIL = '#C9B79C';
const STONE = '#B9B3CC';
const FISH = '#FF9F43';
const EYE = '#33294A';
const PINK = '#E5677F';

/** One item drawn in a 64 x 64 box. `notch` is the colour behind it, for the lily pad's cut. */
function TileShapes({ id, notch, reed, reedDark }: { id: ItemId; notch: string; reed: string; reedDark: string }) {
  switch (id) {
    case 'lilypad':
      return (
        <G>
          <Ellipse cx={32} cy={38} rx={24} ry={12} fill={reed} />
          <Path d="M32 38 L57 33 L56 42 Z" fill={notch} />
          <Path d="M32 38 L14 34 M32 38 L20 46" stroke={reedDark} strokeWidth={2} strokeLinecap="round" />
        </G>
      );
    case 'waterlily':
      return (
        <G>
          <Ellipse cx={32} cy={46} rx={22} ry={8} fill={reed} />
          <Ellipse cx={32} cy={30} rx={6} ry={13} fill={PETAL} transform="rotate(-38 32 40)" />
          <Ellipse cx={32} cy={30} rx={6} ry={13} fill={PETAL} transform="rotate(38 32 40)" />
          <Ellipse cx={32} cy={28} rx={6} ry={14} fill={PETAL_DEEP} />
          <Circle cx={32} cy={40} r={5} fill={SUN} />
        </G>
      );
    case 'frog':
      return (
        <G>
          <Ellipse cx={32} cy={40} rx={18} ry={13} fill={FROG} />
          <Circle cx={23} cy={27} r={6} fill={FROG} />
          <Circle cx={41} cy={27} r={6} fill={FROG} />
          <Circle cx={23} cy={27} r={3} fill={EYE} />
          <Circle cx={41} cy={27} r={3} fill={EYE} />
          <Path d="M24 42 Q32 48 40 42" fill="none" stroke={FROG_DARK} strokeWidth={2.5} strokeLinecap="round" />
        </G>
      );
    case 'beanie':
      return (
        <G>
          <Path d="M14 42 C14 26 22 18 32 18 C42 18 50 26 50 42 Z" fill={WING_EDGE} />
          <Rect x={12} y={40} width={40} height={9} rx={4.5} fill={TEAL} />
          <Circle cx={32} cy={15} r={5} fill={PAPER} stroke={TEAL} strokeWidth={2} />
        </G>
      );
    case 'cattails':
      return (
        <G>
          <Path d="M22 56 L24 24 M33 56 L33 18 M44 56 L42 28" stroke={reedDark} strokeWidth={3} strokeLinecap="round" />
          <Rect x={21} y={16} width={6} height={16} rx={3} fill={BARK} />
          <Rect x={30} y={10} width={6} height={16} rx={3} fill={BARK} />
          <Rect x={39} y={20} width={6} height={14} rx={3} fill={BARK} />
        </G>
      );
    case 'dragonfly':
      return (
        <G>
          <Ellipse cx={22} cy={24} rx={11} ry={5} fill={WING} stroke={WING_EDGE} strokeWidth={2} />
          <Ellipse cx={42} cy={24} rx={11} ry={5} fill={WING} stroke={WING_EDGE} strokeWidth={2} />
          <Ellipse cx={23} cy={33} rx={10} ry={4.5} fill={WING} stroke={WING_EDGE} strokeWidth={2} />
          <Ellipse cx={41} cy={33} rx={10} ry={4.5} fill={WING} stroke={WING_EDGE} strokeWidth={2} />
          <Path d="M32 16 L32 52" stroke={TEAL} strokeWidth={4} strokeLinecap="round" />
        </G>
      );
    case 'boat':
      return (
        <G>
          <Path
            d="M10 40 L54 40 L46 50 L18 50 Z"
            fill={PAPER}
            stroke={INK_SOFT}
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
          <Path d="M20 40 L32 18 L44 40 Z" fill={PAPER} stroke={INK_SOFT} strokeWidth={2.5} strokeLinejoin="round" />
        </G>
      );
    case 'bow':
      return (
        <G>
          <Path d="M32 32 L14 22 L14 42 Z" fill={PETAL_DEEP} />
          <Path d="M32 32 L50 22 L50 42 Z" fill={PETAL_DEEP} />
          <Circle cx={32} cy={32} r={5} fill={PINK} />
        </G>
      );
    case 'snail':
      return (
        <G>
          <Path d="M12 50 L50 50 Q54 50 52 46 L22 46 Q16 46 14 40 Q12 46 12 50 Z" fill={SNAIL} />
          <Path d="M16 42 L13 32 M19 42 L19 33" stroke={SNAIL} strokeWidth={2.5} strokeLinecap="round" />
          <Circle cx={36} cy={36} r={13} fill={SHELL} />
          <Path d="M30 36 a6 6 0 1 0 6 -6" fill="none" stroke={SHELL_LINE} strokeWidth={2.5} strokeLinecap="round" />
        </G>
      );
    case 'stones':
      return (
        <G>
          <Ellipse cx={18} cy={44} rx={10} ry={5} fill={STONE} />
          <Ellipse cx={34} cy={36} rx={9} ry={4.5} fill={STONE} />
          <Ellipse cx={48} cy={28} rx={8} ry={4} fill={STONE} />
        </G>
      );
    case 'goldfish':
      return (
        <G>
          <Path d="M14 32 C22 20 40 20 46 32 C40 44 22 44 14 32 Z" fill={FISH} />
          <Path d="M46 32 L56 24 L56 40 Z" fill={FISH} />
          <Circle cx={22} cy={30} r={2.5} fill={EYE} />
        </G>
      );
    case 'scarf':
      return (
        <G>
          <Path d="M14 26 Q32 36 50 26 L50 34 Q32 44 14 34 Z" fill={PINK} />
          <Path d="M40 34 L44 54 L36 54 L34 36 Z" fill={PINK} />
        </G>
      );
  }
}

/** An item on its own, for tiles and cards. Locked items are drawn faded. Things to wear use their pictures. */
export function ItemArt({
  id,
  size = 44,
  dim = false,
  behind,
}: {
  id: ItemId;
  size?: number;
  dim?: boolean;
  behind: string;
}) {
  const { colors } = useTheme();
  const picture = wearIcons[id];
  if (picture) {
    return (
      <Image
        source={picture}
        style={{ width: size, height: size, opacity: dim ? 0.3 : 1 }}
        resizeMode="contain"
        fadeDuration={0}
      />
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" opacity={dim ? 0.3 : 1}>
      <TileShapes id={id} notch={behind} reed={colors.reed} reedDark={colors.reedDark} />
    </Svg>
  );
}

/**
 * The items placed in the pond scene (its 360 x 240 drawing). The duck stands in the middle
 * (about x 125-255), so everything sits out to the sides where it's never hidden. `layer` is
 * "water" (drawn before the reeds and bank) or "bank" (drawn on the bank, in front).
 */
export function PondItems({ items, layer }: { items: readonly ItemId[]; layer: 'water' | 'bank' }) {
  const { colors } = useTheme();
  const has = (id: ItemId) => items.includes(id);
  if (layer === 'bank') {
    return (
      <G>
        {has('stones') && (
          <G fill={STONE} opacity={0.9}>
            <Ellipse cx={58} cy={229} rx={7} ry={3.5} />
            <Ellipse cx={74} cy={226} rx={6} ry={3} />
            <Ellipse cx={89} cy={230} rx={6.5} ry={3.2} />
          </G>
        )}
        {has('snail') && (
          <G>
            <Path d="M288 231 L312 231 Q315 231 313 228 L296 227 Q291 227 290 223 Q288 227 288 231 Z" fill={SNAIL} />
            <Path d="M291 225 L289 218 M293 225 L293 219" stroke={SNAIL} strokeWidth={1.6} strokeLinecap="round" />
            <Circle cx={303} cy={223} r={6.5} fill={SHELL} />
            <Path
              d="M300 223 a3 3 0 1 0 3 -3"
              fill="none"
              stroke={SHELL_LINE}
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          </G>
        )}
      </G>
    );
  }
  return (
    <G>
      {has('dragonfly') && (
        <G>
          <Ellipse cx={46} cy={101} rx={6} ry={2.6} fill={WING} stroke={WING_EDGE} strokeWidth={1} />
          <Ellipse cx={58} cy={101} rx={6} ry={2.6} fill={WING} stroke={WING_EDGE} strokeWidth={1} />
          <Ellipse cx={46.5} cy={106} rx={5.5} ry={2.4} fill={WING} stroke={WING_EDGE} strokeWidth={1} />
          <Ellipse cx={57.5} cy={106} rx={5.5} ry={2.4} fill={WING} stroke={WING_EDGE} strokeWidth={1} />
          <Path d="M52 96 L52 114" stroke={TEAL} strokeWidth={2.4} strokeLinecap="round" />
        </G>
      )}
      {has('boat') && (
        <G>
          <Path
            d="M286 160 L314 160 L309 166 L291 166 Z"
            fill={PAPER}
            stroke={INK_SOFT}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          <Path
            d="M292 160 L300 146 L308 160 Z"
            fill={PAPER}
            stroke={INK_SOFT}
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
        </G>
      )}
      {has('goldfish') && (
        <G>
          <Path d="M96 180 C100 174 110 174 114 180 C110 186 100 186 96 180 Z" fill={FISH} />
          <Path d="M114 180 L120 175 L120 185 Z" fill={FISH} />
          <Circle cx={100} cy={179} r={1.4} fill={EYE} />
          <Path
            d="M92 188 q4 -3 8 0 M112 189 q4 -3 8 0"
            stroke={colors.pondLight}
            strokeWidth={1.6}
            strokeLinecap="round"
            fill="none"
          />
        </G>
      )}
      {has('lilypad') && (
        <G>
          <Ellipse cx={74} cy={196} rx={22} ry={6.5} fill={colors.reed} />
          <Path d="M74 196 L97 192 L96 199 Z" fill={colors.pond} />
        </G>
      )}
      {has('frog') && (
        <G>
          <Ellipse cx={74} cy={189} rx={11} ry={8} fill={FROG} />
          <Circle cx={68} cy={181} r={3.6} fill={FROG} />
          <Circle cx={80} cy={181} r={3.6} fill={FROG} />
          <Circle cx={68} cy={181} r={1.8} fill={EYE} />
          <Circle cx={80} cy={181} r={1.8} fill={EYE} />
          <Path d="M69 191 Q74 195 79 191" fill="none" stroke={FROG_DARK} strokeWidth={1.6} strokeLinecap="round" />
        </G>
      )}
      {has('waterlily') && (
        <G>
          <Ellipse cx={276} cy={206} rx={16} ry={5} fill={colors.reed} />
          <Ellipse cx={276} cy={197} rx={3.5} ry={8} fill={PETAL} transform="rotate(-38 276 203)" />
          <Ellipse cx={276} cy={197} rx={3.5} ry={8} fill={PETAL} transform="rotate(38 276 203)" />
          <Ellipse cx={276} cy={196} rx={3.5} ry={8.5} fill={PETAL_DEEP} />
          <Circle cx={276} cy={203} r={3} fill={SUN} />
        </G>
      )}
      {has('cattails') && (
        <G>
          <Path
            d="M343 214 Q340 186 344 160 M352 216 Q353 192 350 170"
            stroke={colors.reedDark}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
          />
          <Rect x={341} y={152} width={6} height={16} rx={3} fill={BARK} />
          <Rect x={347} y={162} width={6} height={14} rx={3} fill={BARK} />
        </G>
      )}
    </G>
  );
}
