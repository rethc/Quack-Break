import { useKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { CountdownRing } from '@/components/CountdownRing';
import { Duck, ENTER_MS, type DuckMode } from '@/components/duck/Duck';
import { PondScene } from '@/components/PondScene';
import { Screen } from '@/components/Screen';
import { SpeechBubble } from '@/components/SpeechBubble';
import { Text } from '@/components/Text';
import { breakLines, doneLines, pickFresh, skipLines } from '@/core/messages';
import { dayKey } from '@/core/schedule';
import { useNow } from '@/hooks/useNow';
import { beginBreak, completeBreakIfDone, skipNow } from '@/services/breaks';
import { haptic } from '@/services/haptics';
import { getData, useData } from '@/services/storage';
import { radius, useTheme } from '@/theme';

type Phase = 'running' | 'done' | 'skipped';

export default function BreakScreen() {
  useKeepAwake();
  const { colors } = useTheme();
  const breakSec = useData((d) => d.settings.breakSec);
  const breakEndsAt = useData((d) => d.timer.breakEndsAt);
  const days = useData((d) => d.days);
  const [skipped, setSkipped] = useState(false);

  // Remember the end time even after the finished break is cleared from the state.
  const [endsAt, setEndsAt] = useState(breakEndsAt ?? 0);
  if (breakEndsAt !== null && breakEndsAt !== endsAt) setEndsAt(breakEndsAt);

  // Normally the break was started before we got here. Start one if not.
  useEffect(() => {
    const t = getData().timer.breakEndsAt;
    if (t === null) beginBreak();
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

  useEffect(() => {
    if (phase !== 'done') return;
    completeBreakIfDone();
    haptic.alert('end');
    AccessibilityInfo.announceForAccessibility('Break over.');
  }, [phase]);

  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setEntered(true), ENTER_MS + 200);
    return () => clearTimeout(id);
  }, []);

  const lines = useMemo(
    () => ({ running: pickFresh(breakLines), done: pickFresh(doneLines), skipped: pickFresh(skipLines) }),
    [],
  );
  const mode: DuckMode = phase === 'done' ? 'flap' : phase === 'skipped' ? 'shrug' : entered ? 'idle' : 'enter';
  // Ring target is where it will be at the end of this second, so it moves smoothly.
  const progress = Math.min(1, Math.max(0, 1 - (secondsLeft - 1) / breakSec));
  const today = days[dayKey(now)] ?? 0;

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <Screen contentStyle={styles.content}>
      <Text variant="title" center>
        {phase === 'running' ? 'Eye break' : phase === 'done' ? 'Quack quack!' : 'Skipped'}
      </Text>

      <SpeechBubble text={lines[phase]} />

      <PondScene height={200}>
        <Duck mode={mode} size={140} />
      </PondScene>

      {phase === 'running' && (
        <>
          <CountdownRing secondsLeft={secondsLeft} progress={progress} />
          <Button
            title="Skip"
            variant="ghost"
            onPress={() => {
              haptic.soft();
              skipNow();
              setSkipped(true);
            }}
          />
        </>
      )}

      {phase === 'done' && (
        <>
          <View style={[styles.chip, { backgroundColor: colors.card, borderBottomColor: colors.cardEdge }]}>
            <Text variant="label" center>
              🐣 {today} {today === 1 ? 'break' : 'breaks'} today
            </Text>
          </View>
          <Button title="Back to it" onPress={close} style={styles.wide} />
        </>
      )}

      {phase === 'skipped' && <Button title="Back" variant="secondary" onPress={close} style={styles.wide} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', justifyContent: 'center' },
  chip: { borderRadius: radius.m, borderBottomWidth: 4, paddingVertical: 10, paddingHorizontal: 18 },
  wide: { alignSelf: 'stretch' },
});
