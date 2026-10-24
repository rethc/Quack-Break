// The break screen's round window onto the pond, with the countdown ring on its rim.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import type { ItemId } from '@/core/pond';
import { useTheme } from '@/theme';

import { PondScene } from './PondScene';

const STROKE = 8;

/** `progress` goes 0 -> 1 as the break runs; null hides the ring's moving part. */
export function Porthole({
  progress,
  size = 300,
  items,
  children,
}: {
  progress: number | null;
  size?: number;
  /** Things the duck has found, shown in the pond. */
  items?: readonly ItemId[];
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const r = size / 2 - STROKE / 2 - 2;
  const inner = size - 2 * (STROKE + 12);
  const p = useSharedValue(progress ?? 0);

  useEffect(() => {
    if (progress === null) return;
    // It's information, not decoration: with Reduce Motion it moves in steps instead of smoothly.
    p.value = reduceMotion
      ? progress
      : withTiming(progress, { duration: 1000, easing: Easing.linear, reduceMotion: ReduceMotion.Never });
  }, [progress, reduceMotion, p]);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.ringTrack} strokeWidth={STROKE} fill="none" />
      </Svg>
      {progress !== null ? <ProgressArc size={size} r={r} color={colors.ring} p={p} /> : null}
      <View
        style={[
          styles.window,
          { width: inner, height: inner, borderRadius: inner / 2, backgroundColor: colors.heroSky },
        ]}
      >
        <PondScene height={inner} skyColor={colors.heroSky} items={items}>
          {children}
        </PondScene>
      </View>
    </View>
  );
}

/**
 * The arc from 12 o'clock clockwise to `p` (0 to 1) of the way round, with round ends.
 *
 * Nothing is redrawn while it moves: each half of the arc is a half ring drawn once, turned
 * behind a half-circle window, and the round ends are dots, one of them turned with the arc.
 * Animating the SVG itself made react-native-svg repaint the whole ring into a new bitmap every
 * frame, 60 times a second for the whole break.
 */
function ProgressArc({ size, r, color, p }: { size: number; r: number; color: string; p: SharedValue<number> }) {
  const c = size / 2;
  const half = size / 2;
  // Right window (12 to 6 o'clock): the left half ring turns into it as the arc grows to halfway.
  const rightTurn = useAnimatedStyle(() => ({ transform: [{ rotate: `${Math.min(p.value, 0.5) * 360}deg` }] }));
  // Left window (6 to 12 o'clock): then the right half ring turns into it. Hidden until then, as
  // its end sits on the window's edge and anti-aliasing would show a hairline at 6 o'clock.
  const leftTurn = useAnimatedStyle(() => ({
    opacity: p.value > 0.5 ? 1 : 0,
    transform: [{ rotate: `${Math.max(p.value - 0.5, 0) * 360}deg` }],
  }));
  const endTurn = useAnimatedStyle(() => ({
    opacity: p.value > 0 ? 1 : 0,
    transform: [{ rotate: `${p.value * 360}deg` }],
  }));
  const startCap = useAnimatedStyle(() => ({ opacity: p.value > 0 ? 1 : 0 }));
  // Past halfway, a dot as wide as the ring covers the joint of the two halves at 6 o'clock.
  const joint = useAnimatedStyle(() => ({ opacity: p.value > 0.5 ? 1 : 0 }));
  const halfRing = (d: string) => (
    <Svg width={size} height={size}>
      <Path d={d} stroke={color} strokeWidth={STROKE} fill="none" />
    </Svg>
  );
  const dot = [styles.dot, { left: c - STROKE / 2, top: c - r - STROKE / 2, backgroundColor: color }];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <View style={[styles.clip, { left: half, width: half, height: size }]}>
        <Animated.View style={[styles.turn, { left: -half, width: size, height: size }, rightTurn]}>
          {halfRing(`M ${c} ${c + r} A ${r} ${r} 0 0 1 ${c} ${c - r}`)}
        </Animated.View>
      </View>
      <View style={[styles.clip, { left: 0, width: half, height: size }]}>
        <Animated.View style={[styles.turn, { left: 0, width: size, height: size }, leftTurn]}>
          {halfRing(`M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c} ${c + r}`)}
        </Animated.View>
      </View>
      <Animated.View style={[...dot, startCap]} />
      <Animated.View style={[styles.dot, { left: c - STROKE / 2, top: c + r - STROKE / 2, backgroundColor: color }, joint]} />
      <Animated.View style={[styles.turn, { left: 0, width: size, height: size }, endTurn]}>
        <View style={dot} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  window: { overflow: 'hidden' },
  clip: { position: 'absolute', top: 0, overflow: 'hidden' },
  turn: { position: 'absolute', top: 0 },
  dot: { position: 'absolute', width: STROKE, height: STROKE, borderRadius: STROKE / 2 },
});
