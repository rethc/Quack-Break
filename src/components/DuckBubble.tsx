import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

/**
 * What the duck is saying, in a small dark bubble. The bubble is centred in `style`'s box and only
 * as wide as its text: a short line gets a short bubble, a long one wraps. Its tail points straight
 * down, `tailOffset` to the right of the bubble's centre, so it can sit over the duck's beak.
 */
export function DuckBubble({ text, style, tailOffset = 0 }: { text: string; style?: ViewStyle; tailOffset?: number }) {
  const { colors } = useTheme();
  // Never so narrow that the tail would slip under a rounded corner.
  const minWidth = 2 * (Math.abs(tailOffset) + TAIL_HALF + RADIUS);
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.bubble, { backgroundColor: colors.ink, minWidth }]}>
        {/* The duck's chatter grows less than the rest with large text, so it never covers the scene. */}
        <Text variant="label" color={colors.bg} center style={styles.text} maxFontSizeMultiplier={1.3}>
          {text}
        </Text>
      </View>
      <View style={[styles.tail, { borderTopColor: colors.ink, transform: [{ translateX: tailOffset }] }]} />
    </View>
  );
}

const RADIUS = 18;
const TAIL_HALF = 9;

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  bubble: { borderRadius: RADIUS, paddingVertical: 10, paddingHorizontal: 14 },
  text: { fontSize: 15, lineHeight: 20 },
  tail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderTopWidth: 12,
    borderLeftWidth: TAIL_HALF,
    borderRightWidth: TAIL_HALF,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
