// Your pond: the duck, how it's growing, and everything found so far. Hats and scarves can be worn.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Duck } from '@/components/duck/Duck';
import { BackIcon, IconButton, LockIcon } from '@/components/Icons';
import { ItemArt } from '@/components/pond/art';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import {
  cleanName,
  describeDuck,
  ITEMS,
  MAX_NAME_LENGTH,
  nextStage,
  stageFor,
  unlockedItems,
  type Item,
} from '@/core/pond';
import { haptic } from '@/services/haptics';
import { markPondSeenNow, renameNow, wearNow } from '@/services/pond';
import { useData } from '@/services/storage';
import { fonts, useTheme } from '@/theme';

export default function PondScreen() {
  const { colors } = useTheme();
  const pond = useData((d) => d.pond);
  const stage = stageFor(pond.total);
  const next = nextStage(pond.total);
  const found = unlockedItems(pond.total).length;
  const [name, setName] = useState(pond.name);

  // Looking at the pond clears the "New" mark on Home.
  useEffect(() => {
    markPondSeenNow();
  }, [pond.total]);

  const progress = next ? (pond.total - stage.from) / (next.from - stage.from) : 1;
  const saveName = () => {
    renameNow(name);
    setName(cleanName(name));
  };
  // Leaving with Android's Back while still typing ends editing too late to save: save on the
  // way out as well (nothing is written if the name didn't change).
  const typed = useRef<string | null>(null);
  const onType = (text: string) => {
    typed.current = text;
    setName(text);
  };
  useEffect(
    () => () => {
      if (typed.current !== null) renameNow(typed.current);
    },
    [],
  );

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}>
          {(c) => <BackIcon color={c} />}
        </IconButton>
        <Text variant="title" style={styles.flex}>
          Your pond
        </Text>
      </View>

      <View style={[styles.summary, { backgroundColor: colors.card }]}>
        <View style={[styles.duckCircle, { backgroundColor: colors.heroSky }]}>
          <Duck mode="idle" size={76} stage={stage.id} wearing={pond.wearing} who={describeDuck(pond)} />
        </View>
        <View style={styles.summaryText}>
          <TextInput
            value={name}
            onChangeText={onType}
            onEndEditing={saveName}
            onSubmitEditing={saveName}
            maxLength={MAX_NAME_LENGTH}
            returnKeyType="done"
            selectTextOnFocus
            accessibilityLabel="Your duck's name"
            accessibilityHint="Type a new name"
            style={[styles.name, { color: colors.ink, borderBottomColor: colors.line }]}
          />
          <Text variant="body">{stage.name}</Text>
          <Text variant="small" soft>
            {pond.total === 1 ? '1 break so far' : `${pond.total} breaks so far`}
          </Text>
          <View
            style={[styles.track, { backgroundColor: colors.line }]}
            accessible
            accessibilityLabel={
              next ? `${pond.total} of ${next.from} breaks to ${next.name.toLowerCase()}` : 'Fully grown'
            }
          >
            <View
              style={[styles.fill, { backgroundColor: colors.primaryEdge, width: `${Math.round(progress * 100)}%` }]}
            />
          </View>
          <Text variant="small" soft>
            {next ? `${next.name} at ${next.from} breaks` : 'Fully grown'}
          </Text>
        </View>
      </View>

      <View style={styles.sectionRow}>
        <Text variant="label" soft style={styles.flex} accessibilityRole="header">
          Found so far
        </Text>
        <Text variant="small" soft>
          {found} of {ITEMS.length}
        </Text>
      </View>

      <View style={styles.grid}>
        {ITEMS.map((item) => (
          <Tile
            key={item.id}
            item={item}
            unlocked={pond.total >= item.at}
            wearing={pond.wearing === item.id}
            onWear={() => {
              haptic.tap();
              wearNow(item.id);
            }}
          />
        ))}
      </View>

      <Text variant="small" soft center>
        A break counts toward your pond when it ends at least 5 minutes after the last one.
      </Text>
    </Screen>
  );
}

function Tile({
  item,
  unlocked,
  wearing,
  onWear,
}: {
  item: Item;
  unlocked: boolean;
  wearing: boolean;
  onWear: () => void;
}) {
  const { colors } = useTheme();
  const artBg = unlocked ? colors.heroSky : colors.line;
  const canWear = unlocked && item.kind === 'wear';
  const status = !unlocked ? `At ${item.at} breaks` : canWear ? (wearing ? 'Wearing' : 'Tap to wear') : 'In your pond';
  const content = (
    <>
      <View style={[styles.art, { backgroundColor: artBg }]}>
        <ItemArt id={item.id} size={44} dim={!unlocked} behind={artBg} />
      </View>
      <Text variant="small" center style={styles.tileName}>
        {item.name}
      </Text>
      <View style={styles.status}>
        {!unlocked && <LockIcon color={colors.inkSoft} size={13} />}
        <Text variant="small" color={canWear ? colors.accentText : colors.inkSoft} style={canWear && styles.bold}>
          {status}
        </Text>
      </View>
    </>
  );

  if (canWear) {
    return (
      <Pressable
        onPress={onWear}
        accessibilityRole="button"
        accessibilityState={{ selected: wearing }}
        accessibilityLabel={`${item.name}. ${wearing ? 'Wearing. Tap to take it off.' : 'Tap to wear it.'}`}
        style={({ pressed }) => [
          styles.tile,
          { backgroundColor: colors.card, borderColor: wearing ? colors.primaryEdge : colors.card },
          pressed && { opacity: 0.7 },
        ]}
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={
        unlocked ? `${item.name}. In your pond.` : `${item.name}. Locked. Unlocks at ${item.at} breaks.`
      }
      style={[styles.tile, { backgroundColor: colors.card, borderColor: colors.card }]}
    >
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
  summary: { borderRadius: 22, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
  duckCircle: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center' },
  summaryText: { flex: 1, gap: 4 },
  name: { fontFamily: fonts.semibold, fontSize: 21, paddingVertical: 2, paddingHorizontal: 0, borderBottomWidth: 1 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 6 },
  fill: { height: 8, borderRadius: 4 },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingHorizontal: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    flexBasis: '30%',
    flexGrow: 1,
    borderRadius: 18,
    borderWidth: 2,
    paddingVertical: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    gap: 6,
  },
  art: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileName: { fontFamily: fonts.semibold },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bold: { fontFamily: fonts.semibold },
});
