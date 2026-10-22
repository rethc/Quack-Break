// A few hand-drawn icons, so we don't need an icon font.
import { Pressable, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/theme';

export function GearIcon({ color, size = 26 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M10.3 2.6h3.4l.5 2.4 1.6.7 2.1-1.3 2.4 2.4-1.3 2.1.7 1.6 2.4.5v3.4l-2.4.5-.7 1.6 1.3 2.1-2.4 2.4-2.1-1.3-1.6.7-.5 2.4h-3.4l-.5-2.4-1.6-.7-2.1 1.3-2.4-2.4 1.3-2.1-.7-1.6-2.4-.5v-3.4l2.4-.5.7-1.6-1.3-2.1 2.4-2.4 2.1 1.3 1.6-.7z"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3.2} fill="none" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

export function BackIcon({ color, size = 26 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M15 5l-7 7 7 7" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronIcon({ color, size = 22 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M9 5l7 7-7 7" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function IconButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress: () => void;
  children: (color: string) => React.ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.icon,
        { backgroundColor: colors.card, borderColor: colors.cardEdge },
        pressed && { transform: [{ scale: 0.94 }] },
      ]}
    >
      {children(colors.ink)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
  },
});
