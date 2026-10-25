// The duck: the frames from the sprite sheets (assets/duck), all stacked and loaded, with one shown
// at a time. Which one, and where the duck is, run on the UI thread with Reanimated. Idle animations
// are short and spaced out (no endless loops), so the screen isn't redrawn constantly. With Reduce
// Motion on, the duck just takes each mode's pose without moving.
import { useEffect } from 'react';
import { AppState, StyleSheet, useWindowDimensions, View, type ImageSourcePropType } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  type DerivedValue,
} from 'react-native-reanimated';

import type { ItemId } from '@/core/pond';

import { headOffset } from './layout';
import { duckFrames, wearPictures, type FrameName } from './pictures';

export type DuckMode = 'enter' | 'idle' | 'attention' | 'flap' | 'shrug' | 'sleep' | 'rest';

/** What the duck is doing, after its description ("Jenny, a young duck, ..."). */
const actions: Record<DuckMode, string> = {
  enter: 'walks in',
  idle: 'is floating on the pond',
  attention: 'is waving: break time',
  flap: 'flaps its wings happily',
  shrug: 'shrugs',
  sleep: 'is asleep',
  rest: 'is resting its eyes',
};

/** How long the entrance takes, so screens can wait for it. */
export const ENTER_MS = 1800;

const NAMES = Object.keys(duckFrames) as FrameName[];
const FRAME = Object.fromEntries(NAMES.map((n, i) => [n, i])) as Record<FrameName, number>;
/** Where the head is in each frame, so what the duck wears can follow it. */
const HEAD = NAMES.map((n) => headOffset[n]);
const WALK = [FRAME['walk-1'], FRAME['walk-2'], FRAME['walk-3'], FRAME['walk-4']];
/** Walk frames shown during the walk-in: four times round the cycle, two steps each time. */
const WALK_STEPS = 16;
const SITTING = new Set(['sit', 'sleepy', 'content', 'dozing', 'asleep'].map((n) => FRAME[n as FrameName]));

/** The pose each mode settles in, and all you see of it with Reduce Motion on. */
const POSE: Record<DuckMode, FrameName> = {
  enter: 'stand',
  idle: 'stand',
  attention: 'wave',
  flap: 'happy',
  shrug: 'stand',
  sleep: 'asleep',
  rest: 'content',
};

export function Duck({
  mode,
  size = 180,
  who,
  wearing = null,
}: {
  mode: DuckMode;
  size?: number;
  /** For screen readers, e.g. "Jenny, a young duck". */
  who?: string;
  wearing?: ItemId | null;
}) {
  const reduceMotion = useReducedMotion();
  const { width: screenWidth } = useWindowDimensions();

  const startX = -(screenWidth / 2 + size);
  const walk = useSharedValue(mode === 'enter' && !reduceMotion ? 0 : 1);
  const pose = useSharedValue(FRAME[reduceMotion ? POSE[mode] : 'stand']);
  const y = useSharedValue(0);
  const tilt = useSharedValue(0);

  useEffect(() => {
    [walk, pose, y, tilt].forEach((v) => cancelAnimation(v));
    const cleanups: (() => void)[] = [];
    const cleanup = () => cleanups.forEach((fn) => fn());
    const every = (ms: number, fn: () => void) => {
      const id = setInterval(() => {
        if (AppState.currentState === 'active') fn();
      }, ms);
      cleanups.push(() => clearInterval(id));
    };
    const after = (ms: number, fn: () => void) => {
      const id = setTimeout(fn, ms);
      cleanups.push(() => clearTimeout(id));
    };
    const t = (to: number, ms: number, easing = Easing.inOut(Easing.quad)) => withTiming(to, { duration: ms, easing });
    /** Shows frames one after another, each for its time; the last one stays. */
    const play = (...steps: [FrameName, number][]) => {
      pose.value = withSequence(
        ...steps.map(([name], i) => withDelay(steps[i - 1]?.[1] ?? 0, withTiming(FRAME[name], { duration: 0 }))),
      );
    };

    const wasSitting = SITTING.has(Math.round(pose.value));
    walk.value = 1;
    y.value = 0;
    tilt.value = 0;
    if (reduceMotion) {
      pose.value = FRAME[POSE[mode]];
      return cleanup;
    }

    const blink = () => play(['blink', 130], ['stand', 0]);
    // Standing up first, when the duck was sitting.
    const standing = (start: () => void) => {
      if (!wasSitting) return start();
      play(['sit', 0]);
      after(220, start);
    };

    switch (mode) {
      case 'enter': {
        // A steady walk that eases to a stop; the steps follow `walk`, so they slow down with the duck.
        pose.value = FRAME.stand;
        walk.value = 0;
        walk.value = withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.sin) });
        // Settle onto the water on arrival.
        y.value = withDelay(ENTER_MS - 60, withSequence(t(size * 0.02, 140, Easing.out(Easing.quad)), t(0, 280)));
        after(ENTER_MS + 400, startIdle);
        break;
      }
      case 'idle':
        standing(() => {
          pose.value = FRAME.stand;
          startIdle();
        });
        break;
      case 'attention': {
        // Break time: a hop and a wave, with a blink in between.
        const wave = () => {
          y.value = withSequence(t(-14, 200, Easing.out(Easing.quad)), t(0, 260, Easing.bounce));
          play(['wave', 170], ['talk', 170], ['wave', 170], ['talk', 170], ['wave', 220], ['stand', 1500], ['blink', 130], ['stand', 0]);
        };
        standing(() => {
          wave();
          every(3200, wave);
        });
        break;
      }
      case 'flap':
        // Break done: wings up, twice, then a happy face.
        standing(() => {
          play(['cheer', 200], ['happy', 170], ['cheer', 200], ['happy', 170], ['cheer', 260], ['happy', 0]);
          y.value = withSequence(
            t(-24, 230, Easing.out(Easing.quad)),
            t(0, 280, Easing.bounce),
            withDelay(80, t(-14, 180, Easing.out(Easing.quad))),
            t(0, 240, Easing.bounce),
          );
          tilt.value = withSequence(t(-6, 200), t(5, 260), t(0, 240));
        });
        break;
      case 'shrug':
        standing(() => {
          play(['talk', 420], ['stand', 160], ['blink', 140], ['stand', 0]);
          tilt.value = withSequence(t(-7, 260), withDelay(700, t(0, 300)));
          y.value = withSequence(t(-5, 260), withDelay(700, t(0, 300)));
        });
        break;
      case 'sleep': {
        // Sits down, gets sleepy and nods off; now and then a Zz. Still otherwise, which is cheap on the battery.
        const doze = () => play(['dozing', 1800], ['asleep', 0]);
        if (wasSitting) play(['sleepy', 1000], ['asleep', 0]);
        else play(['stand', 200], ['sit', 700], ['sleepy', 1600], ['asleep', 0]);
        after(4000, () => {
          doze();
          every(5200, doze);
        });
        break;
      }
      case 'rest':
        // During a break the duck sits down and rests its eyes too, then keeps still.
        if (wasSitting) play(['content', 0]);
        else play(['stand', 200], ['sit', 600], ['content', 0]);
        break;
    }

    function startIdle() {
      // Mostly blinks; every third time a little hop and a quack.
      let n = 0;
      every(4300, () => {
        n += 1;
        if (n % 3) return blink();
        play(['talk', 150], ['stand', 110], ['talk', 150], ['stand', 0]);
        y.value = withSequence(t(-6, 180, Easing.out(Easing.quad)), t(0, 260));
      });
    }

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reduceMotion]);

  /** The frame on show: the walk cycle while walking in, the pose otherwise. */
  const shown = useDerivedValue(() =>
    walk.value < 1 ? (WALK[Math.floor(walk.value * WALK_STEPS) % WALK.length] ?? FRAME.stand) : Math.round(pose.value),
  );

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: (1 - walk.value) * startX }, { translateY: y.value }, { rotate: `${tilt.value}deg` }],
  }));
  const wearStyle = useAnimatedStyle(() => {
    const [dx, dy] = HEAD[shown.value] ?? [0, 0];
    return { transform: [{ translateX: dx * size }, { translateY: dy * size }] };
  });

  const box = { width: size, height: size };
  const worn = wearing ? wearPictures[wearing] : undefined;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={who ? `${who}, ${actions[mode]}` : `The duck ${actions[mode]}`}
      style={box}
    >
      {/* Turns around the feet. */}
      <Animated.View style={[box, styles.feet, bodyStyle]}>
        {/* Every frame stays loaded, so changing frames never shows a gap. */}
        {NAMES.map((name, i) => (
          <Frame key={name} index={i} shown={shown} source={duckFrames[name]} />
        ))}
        {worn && (
          <Animated.View style={[StyleSheet.absoluteFill, wearStyle]}>
            <Animated.Image source={worn} style={styles.part} resizeMode="contain" fadeDuration={0} />
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

/** One frame: a picture of the whole duck, see-through around it, shown when it's its turn. */
function Frame({ index, shown, source }: { index: number; shown: DerivedValue<number>; source: ImageSourcePropType }) {
  const style = useAnimatedStyle(() => ({ opacity: shown.value === index ? 1 : 0 }));
  return <Animated.Image source={source} style={[styles.part, style]} resizeMode="contain" fadeDuration={0} />;
}

const styles = StyleSheet.create({
  feet: { transformOrigin: '50% 94%' },
  // An explicit size: a bundled picture otherwise takes its own pixel size, which wins over "fill".
  part: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
});
