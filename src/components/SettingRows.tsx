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

/**
 * A labelled switch. The whole row is tappable. The hint sits under the label, full width,
 * so it never reads as part of the switch.
 */
export function ToggleRow({
  label,
  a11yLabel,
  hint,
  value,
  onChange,
}: {
  label: string;
  /** Fuller name for screen readers, when the label relies on what's around it. */
  a11yLabel?: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { colors, dark } = useTheme();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={a11yLabel ?? label}
      accessibilityHint={hint}
      style={({ pressed }) => [styles.toggleRow, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.toggleTop}>
        <Text variant="body" style={styles.flex}>
          {label}
        </Text>
        <Switch
          value={value}
          onValueChange={onChange}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
          trackColor={{ true: colors.primaryEdge, false: colors.pondLight }}
          // Off: a light knob in dark mode, so the switch is visible on the dark card.
          thumbColor={value ? colors.primary : dark ? colors.inkSoft : colors.card}
          ios_backgroundColor={colors.pondLight}
        />
      </View>
      {hint ? (
        <Text variant="small" soft>
          {hint}
        </Text>
      ) : null}
      <View style={[styles.divider, { backgroundColor: colors.cardEdge }]} />
    </Pressable>
  );
}

/**
 * Pick one of a few options, shown as pills under the label. With `columns`, the pills wrap
 * into a grid. Tapping the chosen pill calls onChange again (handy for replaying a preview).
 */
export function ChoiceRow<T extends string>({
  label,
  value,
  options,
  columns,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  columns?: number;
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.choiceRow}>
      <Text variant="body">{label}</Text>
      <View
        style={[styles.segment, columns ? styles.grid : null, { backgroundColor: colors.secondary }]}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
      >
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              accessibilityLabel={`${label}: ${o.label}`}
              style={[
                styles.segmentItem,
                columns ? { flexBasis: `${100 / columns - 3}%` } : null,
                on && { backgroundColor: colors.primary, borderBottomColor: colors.primaryEdge, borderBottomWidth: 3 },
              ]}
            >
              <Text variant="label" color={on ? colors.onPrimary : colors.onSecondary} center>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
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
  toggleRow: { gap: 2, paddingVertical: 10 },
  toggleTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  choiceRow: { gap: 8, paddingVertical: 10 },
  segment: { flexDirection: 'row', borderRadius: 16, padding: 4, gap: 4 },
  grid: { flexWrap: 'wrap' },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  divider: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, opacity: 0.6 },
});
