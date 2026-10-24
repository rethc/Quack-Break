// The break screen's round window onto the pond, with the countdown ring on its rim.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import type { ItemId } from '@/core/pond';
import { useTheme } from '@/theme';

import { PondScene } from './PondScene';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
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
  const circ = 2 * Math.PI * r;
  const inner = size - 2 * (STROKE + 12);
  const p = useSharedValue(progress ?? 0);

  useEffect(() => {
    if (progress === null) return;
    // It's information, not decoration: with Reduce Motion it moves in steps instead of smoothly.
    p.value = reduceMotion
      ? progress
      : withTiming(progress, { duration: 1000, easing: Easing.linear, reduceMotion: ReduceMotion.Never });
  }, [progress, reduceMotion, p]);

  const ringProps = useAnimatedProps(() => ({ strokeDashoffset: circ * p.value }));

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants">
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.ringTrack} strokeWidth={STROKE} fill="none" />
        {progress !== null ? (
          <AnimatedCircle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.ring}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circ} ${circ}`}
            animatedProps={ringProps}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
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

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  window: { overflow: 'hidden' },
});
