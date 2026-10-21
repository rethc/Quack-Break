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

import { useTheme } from '@/theme';

import { Text } from './Text';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const R = 88;
const CIRC = 2 * Math.PI * R;

/** Ring that empties as the break runs. `progress` goes 0 -> 1. */
export function CountdownRing({ secondsLeft, progress, size = 210 }: { secondsLeft: number; progress: number; size?: number }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const p = useSharedValue(progress);

  useEffect(() => {
    // It's information, not decoration, so it keeps updating with Reduce Motion: in steps instead of smoothly.
    p.value = reduceMotion
      ? progress
      : withTiming(progress, { duration: 1000, easing: Easing.linear, reduceMotion: ReduceMotion.Never });
  }, [progress, reduceMotion, p]);

  const props = useAnimatedProps(() => ({ strokeDashoffset: CIRC * p.value }));

  return (
    <View
      style={{ width: size, height: size }}
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`${secondsLeft} ${secondsLeft === 1 ? 'second' : 'seconds'} left`}
    >
      <Svg width={size} height={size} viewBox="0 0 200 200" style={StyleSheet.absoluteFill}>
        <Circle cx={100} cy={100} r={R} stroke={colors.pondLight} strokeWidth={14} fill={colors.card} />
        <AnimatedCircle
          cx={100}
          cy={100}
          r={R}
          stroke={colors.primary}
          strokeWidth={14}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${CIRC} ${CIRC}`}
          animatedProps={props}
          transform="rotate(-90 100 100)"
        />
      </Svg>
      <View style={styles.center} importantForAccessibility="no-hide-descendants">
        <Text variant="display">{secondsLeft}</Text>
        <Text variant="small" soft>
          seconds
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
});
