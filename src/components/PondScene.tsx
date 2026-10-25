// Backdrop: a little pond. Day has clouds; night has a moon, stars and a few fireflies.
// Fireflies glow for about half a minute and then rest, to save battery.
import { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, useAnimatedValue, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import type { ItemId } from '@/core/pond';
import { useTheme } from '@/theme';

import { PondItems } from './pond/art';

// Out to the sides, over the reeds and open water: never near the duck's head and beak
// (the duck stands in the middle, about x 120-250). In the pond drawing's 360 x 240 coordinates.
const FIREFLIES = [
  { x: 62, y: 128, d: 0 },
  { x: 302, y: 122, d: 700 },
  { x: 346, y: 170, d: 1500 },
  { x: 92, y: 168, d: 2200 },
];

/** The pond drawing fills the view (`xMidYMax slice`): scaled to cover, centred, bottom-aligned. */
function sceneScale(width: number, height: number) {
  const s = Math.max(width / 360, height / 240);
  return { s, x: (width - 360 * s) / 2, y: height - 240 * s };
}

/**
 * The sky lives in the top 90 of the drawing's 240, so its SVG is only that tall (react-native-svg
 * keeps a bitmap the size of each SVG). It keeps the full drawing's width-to-height ratio, so
 * `slice` scales it exactly as it did the whole 360 x 240. The pond stays full height: pinned to
 * the bottom with a fractional height, a shorter view could round to a pixel short of the edge.
 */
const SKY_H = 90;

/**
 * A glowing dot over the pond: plain views, faded by the native animation driver. It used to be two
 * circles inside the pond's SVG with animated opacity, and react-native-svg repainted the whole pond
 * into a new bitmap for every frame of the glow.
 */
function Firefly({ x, y, scale, delay, color }: { x: number; y: number; scale: number; delay: number; color: string }) {
  const reduceMotion = useReducedMotion();
  const glow = useAnimatedValue(0.8);
  useEffect(() => {
    if (reduceMotion) return;
    glow.setValue(0.15);
    const ease = Easing.inOut(Easing.quad);
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 1, duration: 1400, easing: ease, useNativeDriver: true }),
          Animated.timing(glow, { toValue: 0.2, duration: 1600, easing: ease, useNativeDriver: true }),
        ]),
        // Resetting would snap the glow back to its first value between pulses.
        { iterations: 10, resetBeforeIteration: false },
      ),
    ]);
    anim.start();
    return () => anim.stop();
  }, [reduceMotion, delay, glow]);
  // A halo in the dot's colour at 30%, with the bright core on top; both fade with `glow`.
  const halo = 7 * scale;
  const core = 2.6 * scale;
  return (
    <Animated.View
      style={[
        styles.firefly,
        { left: x - halo, top: y - halo, width: 2 * halo, height: 2 * halo, borderRadius: halo, backgroundColor: `${color}4D`, opacity: glow },
      ]}
    >
      <View style={{ width: 2 * core, height: 2 * core, borderRadius: core, backgroundColor: color }} />
    </Animated.View>
  );
}

export function PondScene({
  height = 240,
  sky = true,
  skyColor,
  items = [],
  children,
}: {
  height?: number;
  /** Moon and stars, or clouds. Off where the screen draws its own sky (Home). */
  sky?: boolean;
  /** The colour behind the scene, so the moon's crescent cut-out matches it. */
  skyColor?: string;
  /** Things the duck has found, drawn in the pond. */
  items?: readonly ItemId[];
  children?: React.ReactNode;
}) {
  const { colors, dark } = useTheme();
  // The fireflies are placed over the pond drawing, so they need its width.
  const [width, setWidth] = useState(0);
  const scene = sceneScale(width, height);
  return (
    <View style={[styles.wrap, { height }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {/* Sky is pinned to the top and the pond to the bottom, so wide screens crop
            the middle instead of cutting off the moon. */}
        {sky ? (
          <Svg
            style={[styles.sky, { height: (height * SKY_H) / 240 }]}
            viewBox={`0 0 360 ${SKY_H}`}
            preserveAspectRatio="xMidYMin slice"
          >
            {dark ? (
              <>
                <Circle cx={300} cy={36} r={18} fill={colors.moon} />
                <Circle cx={307} cy={31} r={15} fill={skyColor ?? colors.bg} opacity={0.9} />
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
        ) : null}
        <Svg style={StyleSheet.absoluteFill} viewBox="0 0 360 240" preserveAspectRatio="xMidYMax slice">
          {/* pond */}
          <Ellipse cx={180} cy={196} rx={200} ry={46} fill={colors.pond} />
          <Ellipse cx={180} cy={200} rx={150} ry={30} fill={colors.pondDeep} opacity={0.5} />
          <Path
            d="M90 190 q14 -6 28 0 M230 206 q14 -6 28 0 M150 214 q10 -5 20 0"
            stroke={colors.pondLight}
            strokeWidth={3}
            strokeLinecap="round"
            fill="none"
          />
          {items.length > 0 && <PondItems items={items} layer="water" />}
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
          {items.length > 0 && <PondItems items={items} layer="bank" />}
        </Svg>
        {dark && width > 0
          ? FIREFLIES.map((f) => (
              <Firefly
                key={f.x}
                x={scene.x + f.x * scene.s}
                y={scene.y + f.y * scene.s}
                scale={scene.s}
                delay={f.d}
                color={colors.firefly}
              />
            ))
          : null}
      </View>
      <View style={styles.stage}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', overflow: 'hidden', borderRadius: 30 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 6 },
  sky: { position: 'absolute', top: 0, left: 0, right: 0 },
  firefly: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
});
