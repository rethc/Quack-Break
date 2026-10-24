import { StyleSheet, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/theme';

import { Text } from './Text';

/**
 * A small speech bubble beside the duck, tail pointing down-left at it. The bubble is placed by
 * its right edge and grows to the left, so longer lines stay on one line; `tailFromRight` keeps
 * the tail over the duck's head however wide the bubble gets.
 */
export function DuckBubble({
  text,
  style,
  tailFromRight = 0,
}: {
  text: string;
  style?: ViewStyle;
  tailFromRight?: number;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.wrap, style]}>
      <View style={[styles.bubble, { backgroundColor: colors.ink, minWidth: tailFromRight + TAIL_W + 22 }]}>
        {/* The duck's chatter grows less than the rest with large text, so it never covers the scene. */}
        <Text variant="label" color={colors.bg} style={styles.text} maxFontSizeMultiplier={1.3}>
          {text}
        </Text>
      </View>
      <View style={[styles.tail, { borderTopColor: colors.ink, marginRight: tailFromRight }]} />
    </View>
  );
}

const TAIL_W = 18;

const styles = StyleSheet.create({
  wrap: { alignItems: 'flex-end' },
  bubble: { borderRadius: 18, paddingVertical: 10, paddingHorizontal: 14 },
  text: { fontSize: 15, lineHeight: 20 },
  tail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderTopWidth: 14,
    borderRightWidth: TAIL_W,
    borderRightColor: 'transparent',
  },
});
