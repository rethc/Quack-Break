// Backdrop: a little pond. Day has clouds; night has a moon, stars and a few fireflies.
// Fireflies glow for about half a minute and then rest, to save battery.
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { useTheme } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const FIREFLIES = [
  { x: 60, y: 110, d: 0 },
  { x: 270, y: 115, d: 700 },
  { x: 250, y: 150, d: 1500 },
  { x: 95, y: 60, d: 2200 },
  { x: 330, y: 135, d: 400 },
];

function Firefly({ x, y, delay, color }: { x: number; y: number; delay: number; color: string }) {
  const reduceMotion = useReducedMotion();
  const glow = useSharedValue(0.8);
  useEffect(() => {
    if (reduceMotion) return;
    glow.value = 0.15;
    glow.value = withDelay(
      delay,
      withRepeat(withSequence(withTiming(1, { duration: 1400 }), withTiming(0.2, { duration: 1600 })), 10, false),
    );
  }, [reduceMotion, delay, glow]);
  const core = useAnimatedProps(() => ({ opacity: glow.value }));
  const halo = useAnimatedProps(() => ({ opacity: glow.value * 0.3 }));
  return (
    <G>
      <AnimatedCircle cx={x} cy={y} r={7} fill={color} animatedProps={halo} />
      <AnimatedCircle cx={x} cy={y} r={2.6} fill={color} animatedProps={core} />
    </G>
  );
}

export function PondScene({ height = 240, children }: { height?: number; children?: React.ReactNode }) {
  const { colors, dark } = useTheme();
  return (
    <View style={[styles.wrap, { height }]}>
      <View style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {/* Sky is pinned to the top and the pond to the bottom, so wide screens crop
            the middle instead of cutting off the moon. */}
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 360 240" preserveAspectRatio="xMidYMin slice">
          {dark ? (
            <>
              <Circle cx={300} cy={36} r={18} fill={colors.moon} />
              <Circle cx={307} cy={31} r={15} fill={colors.bg} opacity={0.9} />
              {[
                [40, 30],
                [120, 18],
                [190, 42],
                [250, 16],
                [340, 70],
                [20, 80],
              ].map(([sx, sy]) => (
                <Circle key={`${sx}-${sy}`} cx={sx} cy={sy} r={1.6} fill={colors.star} opacity={0.7} />
              ))}
            </>
          ) : (
            <>
              <G opacity={0.9}>
                <Ellipse cx={70} cy={42} rx={30} ry={12} fill="#FFFFFF" />
                <Ellipse cx={92} cy={36} rx={20} ry={12} fill="#FFFFFF" />
                <Ellipse cx={285} cy={62} rx={26} ry={10} fill="#FFFFFF" />
                <Ellipse cx={302} cy={56} rx={16} ry={10} fill="#FFFFFF" />
              </G>
            </>
          )}
        </Svg>
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 360 240" preserveAspectRatio="xMidYMax slice">
          {/* pond */}
          <Ellipse cx={180} cy={196} rx={200} ry={46} fill={colors.pond} />
          <Ellipse cx={180} cy={200} rx={150} ry={30} fill={colors.pondDeep} opacity={0.5} />
          <Path d="M90 190 q14 -6 28 0 M230 206 q14 -6 28 0 M150 214 q10 -5 20 0" stroke={colors.pondLight} strokeWidth={3} strokeLinecap="round" fill="none" />
          {/* reeds */}
          <G stroke={colors.reed} strokeWidth={5} strokeLinecap="round">
            <Path d="M24 200 Q20 160 28 128" fill="none" />
            <Path d="M38 204 Q40 170 34 146" fill="none" />
            <Path d="M332 204 Q336 166 326 136" fill="none" />
          </G>
          <G fill={colors.reedDark}>
            <Ellipse cx={28} cy={128} rx={5} ry={13} />
            <Ellipse cx={326} cy={136} rx={5} ry={13} />
          </G>
          {/* bank in front, where the duck stands */}
          <Path d="M-10 240 L-10 222 Q180 196 370 222 L370 240 Z" fill={colors.reed} opacity={dark ? 0.6 : 0.55} />
          {dark ? FIREFLIES.map((f) => <Firefly key={f.x} x={f.x} y={f.y} delay={f.d} color={colors.firefly} />) : null}
        </Svg>
      </View>
      <View style={styles.stage}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', overflow: 'hidden', borderRadius: 30 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 },
});
