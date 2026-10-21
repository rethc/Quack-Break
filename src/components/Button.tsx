import { Pressable, StyleSheet, View, type PressableProps } from 'react-native';

import { radius, useTheme } from '@/theme';

import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'ghost';

/** Chunky, rounded button with a "pressable" bottom edge. */
export function Button({
  title,
  variant = 'primary',
  icon,
  style,
  ...rest
}: Omit<PressableProps, 'children'> & { title: string; variant?: Variant; icon?: string }) {
  const { colors } = useTheme();
  const look = {
    primary: { bg: colors.primary, edge: colors.primaryEdge, fg: colors.onPrimary },
    secondary: { bg: colors.secondary, edge: colors.secondaryEdge, fg: colors.onSecondary },
    ghost: { bg: 'transparent', edge: 'transparent', fg: colors.accentText },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      hitSlop={6}
      {...rest}
      style={(state) => [
        styles.base,
        { backgroundColor: look.bg, borderBottomColor: look.edge },
        variant === 'ghost' && styles.ghost,
        state.pressed && styles.pressed,
        rest.disabled && styles.disabled,
        typeof style === 'function' ? style(state) : style,
      ]}
    >
      <View style={styles.row}>
        {icon ? (
          <Text variant="label" color={look.fg} importantForAccessibility="no" accessibilityElementsHidden>
            {icon}
          </Text>
        ) : null}
        <Text variant="label" color={look.fg} center>
          {title}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: radius.m,
    borderBottomWidth: 5,
    paddingHorizontal: 20,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghost: { borderBottomWidth: 0, minHeight: 48 },
  pressed: { transform: [{ translateY: 3 }], borderBottomWidth: 2 },
  disabled: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
});
