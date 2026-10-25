// The home sky. The moon (night) or sun (day) rides an arc from the last break to the next
// one, so you can tell at a glance how close the next break is.
import { StyleSheet } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

import { useTheme } from '@/theme';

type Props = {
  width: number;
  height: number;
  /** 0 just after a break, 1 when the next one is due; null for no arc (quiet hours, a running break). */
  progress: number | null;
  /** Where the arc meets the horizon (just above the pond). */
  baseY: number;
  /** The arc's peak. */
  topY: number;
};

/** Stars sit in the corners above the arc: x as a share of the width, y as a share of the gap above it. */
const STARS: readonly [number, number, number][] = [
  [0.07, 0.55, 1.4],
  [0.15, 0.3, 1.6],
  [0.27, 0.6, 1.3],
  [0.73, 0.45, 1.3],
  [0.86, 0.25, 1.6],
  [0.94, 0.6, 1.4],
];

export function SkyClock({ width, height, progress, baseY, topY }: Props) {
  const { colors, dark } = useTheme();
  if (width <= 0 || height <= 0) return null;

  const cx = width / 2;
  const rx = width / 2 - 26;
  const ry = Math.max(40, baseY - topY);
  /** How far down the arc is at this x (the horizon outside it). */
  const arcY = (x: number) => {
    const d = (x - cx) / rx;
    return Math.abs(d) >= 1 ? baseY : baseY - ry * Math.sqrt(1 - d * d);
  };
  /** A two-puff cloud at x, tucked in the corner between the top edge and the arc; `dir` < 0 mirrors it. */
  const cloud = (x: number, dir: 1 | -1, k: number) => {
    const inner = x + dir * 42 * k;
    const room = arcY(inner) - 12;
    if (room < 8 + 38 * k) return null;
    const y = (8 + room) / 2;
    return (
      <G key={x}>
        <Ellipse cx={x} cy={y} rx={30 * k} ry={12 * k} />
        <Ellipse cx={x + dir * 22 * k} cy={y - 7 * k} rx={20 * k} ry={12 * k} />
      </G>
    );
  };
  const p = progress === null ? null : Math.min(1, Math.max(0, progress));

  // On the arc, or resting at its peak when there's no countdown.
  let bx = cx;
  let by = topY;
  let travelled = '';
  let ahead = '';
  if (p !== null) {
    const t = Math.PI * (1 - p);
    bx = cx + rx * Math.cos(t);
    by = baseY - ry * Math.sin(t);
    const arc = `${rx} ${ry} 0 0 1`;
    travelled = `M ${cx - rx} ${baseY} A ${arc} ${bx} ${by}`;
    ahead = `M ${bx} ${by} A ${arc} ${cx + rx} ${baseY}`;
  }

  // Nothing is drawn below the arc's ends plus the sun's glow, so the SVG (a bitmap of its own size)
  // stops there instead of covering the whole panel.
  const drawnH = Math.min(height, baseY + 26);
  return (
    <Svg
      width={width}
      height={drawnH}
      style={styles.sky}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {dark ? (
        STARS.map(([fx, fy, r]) => {
          const x = fx * width;
          return <Circle key={fx} cx={x} cy={10 + fy * (arcY(x) - 24)} r={r} fill={colors.star} opacity={0.55} />;
        })
      ) : (
        <G fill="#FFFFFF" opacity={0.95}>
          {/* Clouds in the top corners, clear of the arc and the countdown under it. */}
          {cloud(0.13 * width, 1, 1)}
          {cloud(0.87 * width, -1, 0.8)}
        </G>
      )}
      {p !== null && p > 0.005 ? (
        <Path
          d={travelled}
          fill="none"
          stroke={colors.arc}
          strokeWidth={3}
          strokeLinecap="round"
          opacity={dark ? 0.75 : 1}
        />
      ) : null}
      {p !== null && p < 0.995 ? (
        <Path
          d={ahead}
          fill="none"
          stroke={colors.arcRest}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray="2 10"
          opacity={dark ? 0.55 : 0.45}
        />
      ) : null}
      {dark ? (
        <>
          <Circle cx={bx} cy={by} r={16} fill={colors.moon} />
          <Circle cx={bx + 7} cy={by - 5} r={13} fill={colors.heroSky} />
        </>
      ) : (
        <>
          <Circle cx={bx} cy={by} r={24} fill={colors.sunGlow} />
          <Circle cx={bx} cy={by} r={16} fill={colors.sun} />
        </>
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  sky: { position: 'absolute', top: 0, left: 0 },
});
