import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Duck, ENTER_MS, type DuckMode } from '@/components/duck/Duck';
import { ItemArt } from '@/components/pond/art';
import { STAGE_SCALE } from '@/components/pond/PondProgress';
import { Porthole } from '@/components/Porthole';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { breakLines, doneLines, pickFresh, skipLines } from '@/core/messages';
import { describeDuck, stageFor, unlocksBetween } from '@/core/pond';
import { dayKey } from '@/core/schedule';
import { useNow } from '@/hooks/useNow';
import { completeBreakIfDone, skipNow } from '@/services/breaks';
import { haptic } from '@/services/haptics';
import { getData, useData } from '@/services/storage';
import { fonts, radius, useTheme } from '@/theme';

type Phase = 'running' | 'done' | 'skipped';

const KEEP_AWAKE_TAG = 'break';
const NOTHING_NEW: ReturnType<typeof unlocksBetween> = { stage: null, items: [] };

/** Back to Home, which is always underneath (replacing would leave a second Home behind). */
const leave = () => (router.canGoBack() ? router.back() : router.replace('/'));

export default function BreakScreen() {
  const { colors } = useTheme();
  const breakSec = useData((d) => d.settings.breakSec);
  const breakEndsAt = useData((d) => d.timer.breakEndsAt);
  const days = useData((d) => d.days);
  const pond = useData((d) => d.pond);
  const [skipped, setSkipped] = useState(false);
  // What this break unlocked for the pond (a new stage or items), shown once it's done.
  // The pond total when the screen opened: what's new is everything unlocked since then.
  const [startTotal] = useState(() => getData().pond.total);
  const stage = stageFor(pond.total);
  // Remember the end time even after the finished break is cleared from the state.
  const [endsAt, setEndsAt] = useState(breakEndsAt ?? 0);
  if (breakEndsAt !== null && breakEndsAt !== endsAt) setEndsAt(breakEndsAt);

  // A break is always started before this screen opens. If none is running (the screen was
  // rebuilt after its break ended, e.g. after a text-size change), go home: never start another.
  useEffect(() => {
    if (getData().timer.breakEndsAt === null) {
      leave();
      return;
    }
    AccessibilityInfo.announceForAccessibility(`Eye break. Look at something far away for ${breakSec} seconds.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const now = useNow((t) => {
    if (skipped || !endsAt || t >= endsAt) return null;
    const left = Math.ceil((endsAt - t) / 1000);
    return endsAt - (left - 1) * 1000;
  });

  const msLeft = endsAt ? endsAt - now : breakSec * 1000;
  const secondsLeft = Math.max(0, Math.ceil(msLeft / 1000));
  const timeUp = endsAt > 0 && msLeft <= 0;
  const phase: Phase = skipped ? 'skipped' : timeUp ? 'done' : 'running';

  // Ended early somewhere else (Stop or End on the tray timer): it doesn't count, so don't
  // finish it here as "Break done". Home shows what happens next.
  useEffect(() => {
    if (breakEndsAt === null && !skipped && endsAt > 0 && Date.now() < endsAt) leave();
  }, [breakEndsAt, skipped, endsAt]);

  // Keep the screen on while the countdown runs, then let the phone sleep and lock as usual:
  // people walk away from the "done" screen.
  useEffect(() => {
    if (phase !== 'running') return;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => {});
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'done') return;
    completeBreakIfDone();
    const found = unlocksBetween(startTotal, getData().pond.total);
    haptic.alert('end');
    const news = [
      found.stage && `${getData().pond.name} grew into a ${found.stage.name.toLowerCase()}`,
      ...found.items.map((i) => `${i.kind === 'wear' ? 'New to wear' : 'New in your pond'}: ${i.name}`),
    ]
      .filter(Boolean)
      .join('. ');
    AccessibilityInfo.announceForAccessibility(news ? `Break over. ${news}.` : 'Break over.');
  }, [phase, startTotal]);

  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setEntered(true), ENTER_MS + 200);
    return () => clearTimeout(id);
  }, []);

  const lines = useMemo(
    () => ({ running: pickFresh(breakLines), done: pickFresh(doneLines), skipped: pickFresh(skipLines) }),
    [],
  );
  // The duck walks in, then sits down and rests its eyes along with you.
  const mode: DuckMode = phase === 'done' ? 'flap' : phase === 'skipped' ? 'shrug' : entered ? 'rest' : 'enter';
  // Ring target is where it will be at the end of this second, so it moves smoothly.
  const progress = Math.min(1, Math.max(0, 1 - (secondsLeft - 1) / breakSec));
  const today = days[dayKey(now)] ?? 0;

  const unlocks = phase === 'done' ? unlocksBetween(startTotal, pond.total) : NOTHING_NEW;

  // While the break runs the screen goes quieter: you're meant to be looking away.
  return (
    <Screen contentStyle={styles.content} background={phase === 'running' ? colors.calm : colors.bg}>
      <Text variant="title" center>
        {phase === 'running' ? 'Look far away' : phase === 'done' ? 'Break done' : 'Break skipped'}
      </Text>

      {/* Just the duck in the window: the break screen stays calm, and the round window would cut the pond's things in half. */}
      <Porthole progress={phase === 'running' ? progress : null}>
        <Duck
          mode={mode}
          size={Math.round(138 * STAGE_SCALE[stage.id])}
          wearing={pond.wearing}
          who={describeDuck(pond)}
        />
      </Porthole>

      {phase === 'running' && (
        <View
          accessible
          accessibilityRole="timer"
          accessibilityLabel={`${secondsLeft} ${secondsLeft === 1 ? 'second' : 'seconds'} left`}
        >
          <Text variant="display" center>
            {secondsLeft}
          </Text>
          <Text variant="body" soft center>
            seconds
          </Text>
        </View>
      )}

      {phase === 'done' && (
        <View style={[styles.chip, { backgroundColor: colors.card }]}>
          <Text variant="label" center>
            {today} {today === 1 ? 'break' : 'breaks'} today
          </Text>
        </View>
      )}

      {phase === 'done' && <Unlocked unlocks={unlocks} duckName={pond.name} />}

      <Text variant="body" soft center style={styles.line}>
        {lines[phase]}
      </Text>

      <View style={styles.actions}>
        {phase === 'running' && (
          <Button
            title="Skip"
            variant="ghost"
            onPress={() => {
              haptic.soft();
              setSkipped(true);
              skipNow();
            }}
          />
        )}
        {phase === 'done' && <Button title="Back to it" onPress={leave} />}
        {phase === 'done' && (unlocks.stage || unlocks.items.length > 0) && (
          <Button title="See your pond" variant="ghost" onPress={() => router.replace('/pond')} />
        )}
        {phase === 'skipped' && <Button title="Back" variant="secondary" onPress={leave} />}
      </View>
    </Screen>
  );
}

/** "New in your pond: Frog friend" or "Jenny grew into a young duck", after a break that unlocked something. */
function Unlocked({ unlocks, duckName }: { unlocks: ReturnType<typeof unlocksBetween>; duckName: string }) {
  const { colors } = useTheme();
  const { stage, items } = unlocks;
  if (!stage && items.length === 0) return null;
  const first = items[0];
  const kicker = stage ? `${duckName} grew up` : first!.kind === 'wear' ? 'New to wear' : 'New in your pond';
  const title = stage ? stage.name : first!.name;
  const rest = stage ? items : items.slice(1);
  return (
    <View
      style={[styles.unlock, { backgroundColor: colors.card }]}
      accessible
      accessibilityLabel={`${kicker}: ${title}.${rest.length ? ` Also new: ${rest.map((i) => i.name).join(', ')}.` : ''}`}
    >
      {/* The card's label says it all: the picture (a duck with its own label) stays out of the way. */}
      <View
        style={[styles.unlockArt, { backgroundColor: colors.heroSky }]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {stage ? (
          <Duck mode="idle" size={56} />
        ) : (
          <ItemArt id={first!.id} size={48} behind={colors.heroSky} />
        )}
      </View>
      <View style={styles.unlockText}>
        <Text variant="small" color={colors.accentText} style={styles.kicker}>
          {kicker}
        </Text>
        <Text variant="heading">{title}</Text>
        {rest.length > 0 && (
          <Text variant="small" soft>
            Also new: {rest.map((i) => i.name).join(', ')}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', justifyContent: 'center', gap: 24 },
  chip: { borderRadius: radius.m, paddingVertical: 10, paddingHorizontal: 18 },
  unlock: { alignSelf: 'stretch', borderRadius: 22, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
  unlockArt: { width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  unlockText: { flex: 1, gap: 2 },
  kicker: { fontFamily: fonts.semibold },
  line: { maxWidth: 300 },
  actions: { alignSelf: 'stretch', gap: 12 },
});
