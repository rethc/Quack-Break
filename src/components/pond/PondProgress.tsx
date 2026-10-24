// Home's pond row: how far to the next thing to find, today's breaks, and the way into the pond.
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { hasNew, nextGoal, type PondState, type StageId } from '@/core/pond';
import { fonts, useTheme } from '@/theme';

import { ChevronIcon } from '../Icons';
import { Text } from '../Text';

/** The duck grows a little with each stage (a share of the screen's full duck size). */
export const STAGE_SCALE: Record<StageId, number> = {
  duckling: 0.75,
  fluffy: 0.83,
  young: 0.9,
  grown: 0.97,
  legend: 1,
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function PondProgress({ pond, today }: { pond: PondState; today: number }) {
  const { colors } = useTheme();
  const goal = nextGoal(pond.total);
  const fresh = hasNew(pond);
  return (
    <View style={styles.wrap}>
      {goal && (
        <View
          style={[styles.card, { backgroundColor: colors.card }]}
          accessible
          accessibilityLabel={`Something new for your pond in ${plural(goal.left, 'break')}`}
        >
          <Text variant="label">Something new in {plural(goal.left, 'break')}</Text>
          <View style={[styles.track, { backgroundColor: colors.line }]}>
            <View
              style={[
                styles.fill,
                { backgroundColor: colors.primaryEdge, width: `${Math.round(goal.progress * 100)}%` },
              ]}
            />
          </View>
        </View>
      )}
      <View style={styles.row}>
        <Text variant="small" soft style={styles.flex}>
          {today === 0 ? 'No breaks yet today' : `${plural(today, 'break')} today`}
        </Text>
        <Pressable
          onPress={() => router.push('/pond')}
          accessibilityRole="link"
          accessibilityLabel={fresh ? 'Your pond. Something new' : 'Your pond'}
          hitSlop={8}
          style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
        >
          {fresh && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text variant="small" color={colors.onPrimary} style={styles.badgeText}>
                New
              </Text>
            </View>
          )}
          <Text variant="label" color={colors.accentText}>
            Your pond
          </Text>
          <ChevronIcon color={colors.accentText} size={18} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: { borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  flex: { flex: 1 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingLeft: 8 },
  badge: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  badgeText: { fontFamily: fonts.semibold },
});
