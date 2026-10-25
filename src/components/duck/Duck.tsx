// The duck. Simple SVG layers moved with Reanimated on the UI thread.
// Idle animations are short and spaced out (no endless loops), so the
// screen isn't redrawn constantly. With Reduce Motion on, the duck just
// changes pose without moving.
import { useEffect } from 'react';
import { AppState, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';

import type { ItemId, StageId } from '@/core/pond';

import { duckColors as C, duckPaths as D, pivots } from './shapes';

export type DuckMode = 'enter' | 'idle' | 'attention' | 'flap' | 'shrug' | 'sleep';

/** What the duck is doing, after its description ("Jenny, a young duck, ..."). */
const actions: Record<DuckMode, string> = {
  enter: 'walks in',
  idle: 'is floating on the pond',
  attention: 'is hopping: break time',
  flap: 'flaps its wings happily',
  shrug: 'shrugs',
  sleep: 'is asleep',
};

/** Which growth features each stage has. Later stages keep the earlier ones' features. */
const STAGE_RANK: Record<StageId, number> = { duckling: 0, fluffy: 1, young: 2, grown: 3, legend: 4 };

/** How long the entrance takes, so screens can wait for it. */
export const ENTER_MS = 1800;

/** Full stride cycles during the walk-in (two footfalls each). */
const STRIDES = 5;

/**
 * Where the walk-in is, from 0 (off screen) to 1 (arrived). Everything in the gait comes
 * from this one value, so the feet always match the distance covered: when the duck
 * slows down, so do its steps. `env` grows in at the start and fades the gait out at the end.
 */
function gait(w: number) {
  'worklet';
  return { phase: w * STRIDES * 2 * Math.PI, env: Math.max(0, Math.min(1, w * 10, (1 - w) * 5)) };
}

export function Duck({
  mode,
  size = 180,
  who,
  stage = 'duckling',
  wearing = null,
}: {
  mode: DuckMode;
  size?: number;
  /** For screen readers, e.g. "Jenny, a young duck". */
  who?: string;
  stage?: StageId;
  wearing?: ItemId | null;
}) {
  const reduceMotion = useReducedMotion();
  const { width: screenWidth } = useWindowDimensions();

  const startX = -(screenWidth / 2 + size);
  const walk = useSharedValue(mode === 'enter' && !reduceMotion ? 0 : 1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const tilt = useSharedValue(0);
  const wing = useSharedValue(0);
  const blink = useSharedValue(1);
  const footFront = useSharedValue(0);
  const footBack = useSharedValue(0);

  const all = [walk, x, y, tilt, wing, blink, footFront, footBack];

  useEffect(() => {
    all.forEach((v) => cancelAnimation(v));
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

    // Resting pose for each mode (also the whole story when Reduce Motion is on).
    walk.value = 1;
    x.value = 0;
    y.value = 0;
    tilt.value = 0;
    footFront.value = 0;
    footBack.value = 0;
    blink.value = 1;
    wing.value = mode === 'shrug' ? 24 : mode === 'flap' ? 30 : mode === 'attention' ? 12 : 0;
    if (reduceMotion) return cleanup;

    const t = (to: number, ms: number, easing = Easing.inOut(Easing.quad)) => withTiming(to, { duration: ms, easing });

    switch (mode) {
      case 'enter': {
        // Steady walk that eases to a stop; the gait follows `walk` (see gait()).
        walk.value = 0;
        walk.value = withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.sin) });
        // Settle onto the water on arrival.
        y.value = withDelay(ENTER_MS - 60, withSequence(t(size * 0.02, 140, Easing.out(Easing.quad)), t(0, 280)));
        after(ENTER_MS + 400, startIdle);
        break;
      }
      case 'idle':
        startIdle();
        break;
      case 'attention': {
        const hop = () => {
          y.value = withSequence(t(-16, 200, Easing.out(Easing.quad)), t(0, 260, Easing.bounce));
          wing.value = withSequence(t(36, 110), t(6, 110), t(36, 110), t(12, 140));
        };
        hop();
        every(3200, hop);
        every(4700, doBlink);
        break;
      }
      case 'flap': {
        wing.value = withSequence(withRepeat(withSequence(t(40, 110), t(-4, 110)), 6), t(0, 200));
        y.value = withSequence(
          t(-24, 230, Easing.out(Easing.quad)),
          t(0, 280, Easing.bounce),
          withDelay(80, t(-14, 180, Easing.out(Easing.quad))),
          t(0, 240, Easing.bounce),
        );
        tilt.value = withSequence(t(-6, 200), t(5, 260), t(0, 240));
        break;
      }
      case 'shrug': {
        wing.value = withSequence(t(28, 260), withDelay(700, t(0, 300)));
        tilt.value = withSequence(t(-7, 260), withDelay(700, t(0, 300)));
        y.value = withSequence(t(-5, 260), withDelay(700, t(0, 300)));
        break;
      }
      case 'sleep':
        // Eyes closed, perfectly still. Cheap on the battery, too.
        break;
    }

    function doBlink() {
      blink.value = withSequence(t(0.1, 70), t(1, 110));
    }
    function startIdle() {
      let n = 0;
      every(4300, () => {
        doBlink();
        n += 1;
        if (n % 3 === 0) {
          y.value = withSequence(t(-5, 260), t(0, 320));
          tilt.value = withSequence(t(4, 260), t(0, 320));
        }
      });
    }

    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reduceMotion]);

  const bob = size * 0.03;
  const lift = size * 0.035;
  const bodyStyle = useAnimatedStyle(() => {
    const g = gait(walk.value);
    return {
      transform: [
        { translateX: x.value + (1 - walk.value) * startX },
        // Highest when the feet pass under the body, lowest when they're spread.
        { translateY: y.value - Math.abs(Math.cos(g.phase)) * bob * g.env },
        // A slight forward lean while walking, with a small waddle.
        { rotate: `${tilt.value + (4 + Math.sin(g.phase) * 2) * g.env}deg` },
      ],
    };
  });
  const wingStyle = useAnimatedStyle(() => {
    const g = gait(walk.value);
    return { transform: [{ rotate: `${wing.value + Math.abs(Math.sin(g.phase)) * 6 * g.env}deg` }] };
  });
  const footFrontStyle = useFootStyle(footFront, walk, 0, lift);
  const footBackStyle = useFootStyle(footBack, walk, Math.PI, lift);
  const eyeStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value }] }));

  const eye = mode === 'flap' ? 'happy' : mode === 'sleep' ? 'closed' : 'open';
  const box = { width: size, height: size };
  const layer = (children: React.ReactNode) => (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      {children}
    </Svg>
  );

  const rank = STAGE_RANK[stage];
  const onHead = wearing === 'beanie' || wearing === 'bow' ? wearing : null;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={who ? `${who}, ${actions[mode]}` : `The duck ${actions[mode]}`}
      style={box}
    >
      <Animated.View style={[box, { transformOrigin: pivots.body }, bodyStyle]}>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: pivots.footBack }, footBackStyle]}>
          {layer(<Path d={D.footBack} fill={C.footBack} />)}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: pivots.footFront }, footFrontStyle]}>
          {layer(<Path d={D.footFront} fill={C.foot} />)}
        </Animated.View>
        <View style={StyleSheet.absoluteFill}>
          {layer(
            <>
              {/* Young and older: tail feathers (grown: two). */}
              {rank >= 2 && <Path d={D.tail} fill={C.shade} />}
              {rank >= 3 && <Path d={D.tail2} fill={C.wing} />}
              <Path d={D.body} fill={C.body} />
              <Path d={D.belly} fill={C.shade} opacity={0.55} />
              <Circle cx={129} cy={62} r={35} fill={C.body} />
              {/* A hat on the head replaces the tuft and the crown. */}
              {!onHead && rank === 4 && (
                <Path d={D.crown} fill={C.shade} stroke={C.beakLine} strokeWidth={2} strokeLinejoin="round" />
              )}
              {!onHead && rank < 4 && <Path d={D.tuft} fill={C.body} />}
              {!onHead && rank === 1 && (
                <>
                  <Path d={D.tuft} fill={C.body} transform="rotate(-32 127 30)" />
                  <Path d={D.tuft} fill={C.body} transform="rotate(30 127 30)" />
                </>
              )}
              <Path d={D.beak} fill={C.beak} />
              <Path d={D.beakLine} fill="none" stroke={C.beakLine} strokeWidth={2.5} strokeLinecap="round" />
              <Ellipse cx={132} cy={75} rx={7.5} ry={4.5} fill={C.cheek} opacity={0.5} />
              {onHead === 'beanie' && (
                <>
                  <Path d={D.beanie} fill={C.beanie} />
                  <Path d={D.beanieBand} fill={C.beanieBand} />
                  <Circle cx={130} cy={10} r={6} fill="#FFFFFF" stroke={C.beanieBand} strokeWidth={2} />
                </>
              )}
              {onHead === 'bow' && (
                <>
                  <Path d={D.bow} fill={C.bow} />
                  <Circle cx={116} cy={30} r={5} fill={C.bowKnot} />
                </>
              )}
              {wearing === 'scarf' && (
                <>
                  <Path d={D.scarf} fill={C.scarf} />
                  <Path d={D.scarfEnd} fill={C.scarf} />
                </>
              )}
            </>,
          )}
        </View>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: pivots.eye }, eyeStyle]}>
          {layer(
            eye === 'open' ? (
              <>
                <Circle cx={140} cy={55} r={7} fill={C.eye} />
                <Circle cx={142.5} cy={52.5} r={2.4} fill="#FFFFFF" />
              </>
            ) : (
              <Path
                d={eye === 'happy' ? D.eyeHappy : D.eyeClosed}
                fill="none"
                stroke={C.eye}
                strokeWidth={4}
                strokeLinecap="round"
              />
            ),
          )}
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: pivots.wing }, wingStyle]}>
          {layer(
            <>
              <Path d={D.wing} fill={C.wing} />
              {/* Grown and older: bright wing tips. */}
              {rank >= 3 && <Path d={D.wingTip} fill="#FFFFFF" opacity={0.6} />}
            </>,
          )}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/** A foot swings from the hip and lifts a little while it moves forward. */
function useFootStyle(angle: SharedValue<number>, walk: SharedValue<number>, offset: number, lift: number) {
  return useAnimatedStyle(() => {
    const g = gait(walk.value);
    const p = g.phase + offset;
    // Positive angles swing the foot back, so it moves forward while the angle falls (cos < 0).
    return {
      transform: [
        { translateY: -Math.max(0, -Math.cos(p)) * lift * g.env },
        { rotate: `${angle.value + Math.sin(p) * 20 * g.env}deg` },
      ],
    };
  });
}
