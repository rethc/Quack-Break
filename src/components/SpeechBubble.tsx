import { StyleSheet, View } from 'react-native';

import { radius, useTheme } from '@/theme';

import { Text } from './Text';

/** What the duck is saying. Screen readers hear it as plain text. */
export function SpeechBubble({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={[styles.bubble, { backgroundColor: colors.card, borderColor: colors.cardEdge }]}>
        <Text variant="label" center>
          {text}
        </Text>
      </View>
      <View style={[styles.tail, { borderTopColor: colors.card }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', alignSelf: 'stretch' },
  bubble: {
    alignSelf: 'stretch',
    borderRadius: radius.m,
    borderBottomWidth: 4,
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderTopWidth: 14,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -4,
  },
});
