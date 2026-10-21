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

import { duckColors as C, duckPaths as D, pivots } from './shapes';

export type DuckMode = 'enter' | 'idle' | 'attention' | 'flap' | 'shrug' | 'sleep';

const labels: Record<DuckMode, string> = {
  enter: 'A little yellow duck waddles in',
  idle: 'A little yellow duck, floating',
  attention: 'The duck is hopping. Break time',
  flap: 'The duck flaps its wings and quacks happily',
  shrug: 'The duck shrugs',
  sleep: 'The duck is asleep',
};

/** How long the entrance takes, so screens can wait for it. */
export const ENTER_MS = 1800;

export function Duck({ mode, size = 180, label }: { mode: DuckMode; size?: number; label?: string }) {
  const reduceMotion = useReducedMotion();
  const { width: screenWidth } = useWindowDimensions();

  const x = useSharedValue(mode === 'enter' && !reduceMotion ? -(screenWidth / 2 + size) : 0);
  const y = useSharedValue(0);
  const tilt = useSharedValue(0);
  const wing = useSharedValue(0);
  const blink = useSharedValue(1);
  const footFront = useSharedValue(0);
  const footBack = useSharedValue(0);

  const all = [x, y, tilt, wing, blink, footFront, footBack];

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
        const steps = 5;
        const step = ENTER_MS / (steps * 2);
        x.value = -(screenWidth / 2 + size);
        x.value = withTiming(0, { duration: ENTER_MS, easing: Easing.out(Easing.quad) });
        tilt.value = withSequence(withRepeat(withSequence(t(8, step), t(-8, step)), steps), t(0, 160));
        y.value = withRepeat(withSequence(t(-6, step), t(0, step)), steps * 2);
        footFront.value = withSequence(withRepeat(withSequence(t(20, step), t(-12, step)), steps), t(0, 120));
        footBack.value = withSequence(withRepeat(withSequence(t(-12, step), t(20, step)), steps), t(0, 120));
        wing.value = withSequence(withRepeat(withSequence(t(10, step * 2), t(0, step * 2)), steps / 2 + 1), t(0, 100));
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

  const bodyStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { rotate: `${tilt.value}deg` }],
  }));
  const wingStyle = useRotate(wing);
  const footFrontStyle = useRotate(footFront);
  const footBackStyle = useRotate(footBack);
  const eyeStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: blink.value }] }));

  const eye = mode === 'flap' ? 'happy' : mode === 'sleep' ? 'closed' : 'open';
  const box = { width: size, height: size };
  const layer = (children: React.ReactNode) => (
    <Svg width={size} height={size} viewBox="0 0 200 200">
      {children}
    </Svg>
  );

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label ?? labels[mode]}
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
              <Path d={D.body} fill={C.body} />
              <Path d={D.belly} fill={C.shade} opacity={0.55} />
              <Circle cx={129} cy={62} r={35} fill={C.body} />
              <Path d={D.tuft} fill={C.body} />
              <Path d={D.beak} fill={C.beak} />
              <Path d={D.beakLine} fill="none" stroke={C.beakLine} strokeWidth={2.5} strokeLinecap="round" />
              <Ellipse cx={132} cy={75} rx={7.5} ry={4.5} fill={C.cheek} opacity={0.5} />
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
          {layer(<Path d={D.wing} fill={C.wing} />)}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

function useRotate(v: SharedValue<number>) {
  return useAnimatedStyle(() => ({ transform: [{ rotate: `${v.value}deg` }] }));
}
