import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { radius, useTheme } from '@/theme';

import { Text } from './Text';

export function Card({ children, title }: { children: React.ReactNode; title?: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderBottomColor: colors.cardEdge }]}>
      {title ? (
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

/** Pick a value from a list with − / +. Screen readers can swipe up/down to adjust. */
export function Stepper<T>({
  label,
  values,
  value,
  format,
  onChange,
}: {
  label: string;
  values: readonly T[];
  value: T;
  format: (v: T) => string;
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  const i = Math.max(0, values.indexOf(value));
  const prev = values[i - 1];
  const next = values[i + 1];
  const step = (d: number) => {
    const v = values[i + d];
    if (v !== undefined) onChange(v);
  };

  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: format(value) }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
    >
      <Text variant="body" style={styles.flex}>
        {label}
      </Text>
      <View style={styles.stepper}>
        <StepButton symbol="−" disabled={prev === undefined} onPress={() => step(-1)} />
        <Text variant="label" style={styles.value} center>
          {format(value)}
        </Text>
        <StepButton symbol="+" disabled={next === undefined} onPress={() => step(1)} />
      </View>
      <View style={[styles.divider, { backgroundColor: colors.cardEdge }]} />
    </View>
  );
}

function StepButton({ symbol, disabled, onPress }: { symbol: string; disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      importantForAccessibility="no"
      style={({ pressed }) => [
        styles.stepBtn,
        { backgroundColor: colors.secondary, borderBottomColor: colors.secondaryEdge },
        pressed && { transform: [{ translateY: 2 }], borderBottomWidth: 1 },
        disabled && { opacity: 0.35 },
      ]}
    >
      <Text variant="heading" color={colors.onSecondary}>
        {symbol}
      </Text>
    </Pressable>
  );
}

/** A switch with its state also written as text, so it doesn't rely on color. */
export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <View style={styles.flex}>
        <Text variant="body">{label}</Text>
        {hint ? (
          <Text variant="small" soft>
            {hint}
          </Text>
        ) : null}
      </View>
      <Text variant="small" soft importantForAccessibility="no" accessibilityElementsHidden>
        {value ? 'On' : 'Off'}
      </Text>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        accessibilityHint={hint}
        trackColor={{ true: colors.primaryEdge, false: colors.pondLight }}
        thumbColor={value ? colors.primary : colors.card}
        ios_backgroundColor={colors.pondLight}
      />
      <View style={[styles.divider, { backgroundColor: colors.cardEdge }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.l, borderBottomWidth: 5, padding: 18, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingVertical: 10 },
  flex: { flex: 1, minWidth: 140 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { minWidth: 76 },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: 16,
    borderBottomWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, opacity: 0.6 },
});
