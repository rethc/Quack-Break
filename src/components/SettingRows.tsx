import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { useTheme } from '@/theme';

import { ChevronIcon } from './Icons';
import { Text } from './Text';

/**
 * A settings group: its name above, then a flat card of rows with thin dividers. Only buttons
 * get the chunky raised edge, so a group never looks pressable.
 */
export function Card({ children, title }: { children: React.ReactNode; title?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section}>
      {title ? (
        <Text variant="label" color={colors.inkSoft} accessibilityRole="header" style={styles.sectionTitle}>
          {title}
        </Text>
      ) : null}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        {/* Rows draw a divider under themselves; this pulls the last one out of sight. */}
        <View style={styles.cardInner}>{children}</View>
      </View>
    </View>
  );
}

/** Text or buttons inside a group that aren't a row. */
export function CardBlock({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.block}>
      {children}
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
    </View>
  );
}

/** A label with a status on the right, e.g. "Notifications: Allowed". */
export function StatusRow({ label, value, color }: { label: string; value: string; color: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="body" style={styles.flex}>
        {label}
      </Text>
      <Text variant="label" color={color}>
        {value}
      </Text>
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
    </View>
  );
}

/** A row that is a text button, e.g. "Send a test reminder". */
export function ActionRow({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }, disabled && { opacity: 0.45 }]}
    >
      <Text variant="label" color={colors.accentText} style={styles.flex}>
        {label}
      </Text>
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
    </Pressable>
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
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
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
        { backgroundColor: colors.secondary },
        pressed && { opacity: 0.7 },
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
          // Track colours stand out 3:1 from the card, on and off.
          trackColor={{ true: colors.switchOn, false: colors.switchOff }}
          thumbColor={value ? colors.primary : dark ? colors.inkSoft : colors.card}
          ios_backgroundColor={colors.switchOff}
        />
      </View>
      {hint ? (
        <Text variant="small" soft>
          {hint}
        </Text>
      ) : null}
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
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
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
    </View>
  );
}

/** A row that opens another screen, showing the current value on the right. */
export function LinkRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <Text variant="body" style={styles.flex}>
        {label}
      </Text>
      <Text variant="body" soft>
        {value}
      </Text>
      <ChevronIcon color={colors.inkSoft} />
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
    </Pressable>
  );
}

/** One choice in a list; the chosen one shows a filled circle. */
export function RadioRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
    >
      <View style={[styles.radio, { borderColor: selected ? colors.primaryEdge : colors.inkSoft }]}>
        {selected ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}
      </View>
      <Text variant={selected ? 'label' : 'body'} style={styles.flex}>
        {label}
      </Text>
      <View style={[styles.divider, { backgroundColor: colors.line }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionTitle: { marginLeft: 16 },
  card: { borderRadius: 22, paddingHorizontal: 16, overflow: 'hidden' },
  cardInner: { marginBottom: -1 },
  block: { gap: 10, paddingVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingVertical: 14, minHeight: 56 },
  flex: { flex: 1, minWidth: 140 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { minWidth: 84 },
  stepBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  toggleRow: { gap: 2, paddingVertical: 14 },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
  toggleTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  choiceRow: { gap: 8, paddingVertical: 14 },
  segment: { flexDirection: 'row', borderRadius: 16, padding: 4, gap: 4 },
  grid: { flexWrap: 'wrap' },
  segmentItem: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  divider: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1 },
});
