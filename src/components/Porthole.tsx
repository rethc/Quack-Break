// The break screen's round window onto the pond, with the countdown ring on its rim.
import { useEffect, useMemo } from 'react';
import { Animated, Easing, StyleSheet, useAnimatedValue, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

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
  const edge = size / 2 - r - STROKE / 2;
  const inner = size - 2 * (STROKE + 12);
  const p = useAnimatedValue(progress ?? 0);

  useEffect(() => {
    if (progress === null) return;
    // It's information, not decoration: with Reduce Motion it moves in steps instead of smoothly.
    if (reduceMotion) {
      p.setValue(progress);
      return;
    }
    Animated.timing(p, { toValue: progress, duration: 1000, easing: Easing.linear, useNativeDriver: true }).start();
  }, [progress, reduceMotion, p]);

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      {/* The track is a bordered view, drawn each frame from a few instructions: an SVG would be a bitmap the size of the ring. */}
      <View
        style={[
          styles.track,
          {
            left: edge,
            top: edge,
            width: 2 * r + STROKE,
            height: 2 * r + STROKE,
            borderRadius: r + STROKE / 2,
            borderColor: colors.ringTrack,
          },
        ]}
        importantForAccessibility="no"
      />
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
 *
 * The turning is React Native's own Animated on the native driver, which sets the views'
 * rotation and opacity directly. Reanimated would commit a new shadow tree for every frame,
 * which kept the main thread busy for the whole break.
 */
function ProgressArc({ size, r, color, p }: { size: number; r: number; color: string; p: Animated.Value }) {
  const c = size / 2;
  const half = size / 2;
  const turns = useMemo(() => {
    const turn = (from: number, to: number) =>
      p.interpolate({ inputRange: [from, to], outputRange: ['0deg', '180deg'], extrapolate: 'clamp' });
    // 0 up to `at`, then 1: a step, since Animated can only interpolate.
    const after = (at: number) =>
      p.interpolate({ inputRange: [at, at + 1e-4], outputRange: [0, 1], extrapolate: 'clamp' });
    return {
      // Right window (12 to 6 o'clock): the left half ring turns into it as the arc grows to halfway.
      right: turn(0, 0.5),
      // Left window (6 to 12 o'clock): then the right half ring turns into it. Hidden until then, as
      // its end sits on the window's edge and anti-aliasing would show a hairline at 6 o'clock.
      left: turn(0.5, 1),
      end: p.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }),
      started: after(0),
      // Past halfway, a dot as wide as the ring covers the joint of the two halves at 6 o'clock.
      pastHalf: after(0.5),
    };
  }, [p]);
  // Each half ring is a bitmap only as wide as itself, drawn in a box of its own half (the right
  // half's box starts at the centre line, so its arc is drawn from x = 0).
  const halfRing = (x: number, fromY: number, toY: number) => (
    <Svg width={half} height={size} style={[styles.halfRing, { left: x }]}>
      <Path d={`M ${c - x} ${fromY} A ${r} ${r} 0 0 1 ${c - x} ${toY}`} stroke={color} strokeWidth={STROKE} fill="none" />
    </Svg>
  );
  const dot = [styles.dot, { left: c - STROKE / 2, top: c - r - STROKE / 2, backgroundColor: color }];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" importantForAccessibility="no-hide-descendants">
      <View style={[styles.clip, { left: half, width: half, height: size }]}>
        <Animated.View
          style={[styles.turn, { left: -half, width: size, height: size, transform: [{ rotate: turns.right }] }]}
        >
          {halfRing(0, c + r, c - r)}
        </Animated.View>
      </View>
      <View style={[styles.clip, { left: 0, width: half, height: size }]}>
        <Animated.View
          style={[
            styles.turn,
            { left: 0, width: size, height: size, opacity: turns.pastHalf, transform: [{ rotate: turns.left }] },
          ]}
        >
          {halfRing(half, c - r, c + r)}
        </Animated.View>
      </View>
      <Animated.View style={[...dot, { opacity: turns.started }]} />
      <Animated.View
        style={[
          styles.dot,
          { left: c - STROKE / 2, top: c + r - STROKE / 2, backgroundColor: color, opacity: turns.pastHalf },
        ]}
      />
      <Animated.View
        style={[
          styles.turn,
          { left: 0, width: size, height: size, opacity: turns.started, transform: [{ rotate: turns.end }] },
        ]}
      >
        <View style={dot} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  track: { position: 'absolute', borderWidth: STROKE },
  window: { overflow: 'hidden' },
  clip: { position: 'absolute', top: 0, overflow: 'hidden' },
  turn: { position: 'absolute', top: 0 },
  halfRing: { position: 'absolute', top: 0 },
  dot: { position: 'absolute', width: STROKE, height: STROKE, borderRadius: STROKE / 2 },
});
