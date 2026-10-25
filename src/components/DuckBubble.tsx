import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

/**
 * What the duck is saying, in a small dark bubble with a tail pointing straight down at it. The
 * bubble is centred in `style`'s box and only as wide as its text: a short line gets a short
 * bubble, a long one wraps.
 */
export function DuckBubble({ text, style }: { text: string; style?: ViewStyle }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.bubble, { backgroundColor: colors.ink }]}>
        {/* The duck's chatter grows less than the rest with large text, so it never covers the scene. */}
        <Text variant="label" color={colors.bg} center style={styles.text} maxFontSizeMultiplier={1.3}>
          {text}
        </Text>
      </View>
      <View style={[styles.tail, { borderTopColor: colors.ink }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  bubble: { borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  text: { fontSize: 15, lineHeight: 20 },
  tail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderTopWidth: 12,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
