import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Duck, ENTER_MS, type DuckMode } from '@/components/duck/Duck';
import { Porthole } from '@/components/Porthole';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { breakLines, doneLines, pickFresh, skipLines } from '@/core/messages';
import { dayKey } from '@/core/schedule';
import { useNow } from '@/hooks/useNow';
import { beginBreak, completeBreakIfDone, skipNow } from '@/services/breaks';
import { haptic } from '@/services/haptics';
import { getData, useData } from '@/services/storage';
import { radius, useTheme } from '@/theme';

type Phase = 'running' | 'done' | 'skipped';

const KEEP_AWAKE_TAG = 'break';

export default function BreakScreen() {
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

  // While the break runs the screen goes quieter: you're meant to be looking away.
  return (
    <Screen contentStyle={styles.content} background={phase === 'running' ? colors.calm : colors.bg}>
      <Text variant="title" center>
        {phase === 'running' ? 'Look far away' : phase === 'done' ? 'Quack quack!' : 'Skipped'}
      </Text>

      <Porthole progress={phase === 'running' ? progress : null}>
        <Duck mode={mode} size={130} />
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
            🐣 {today} {today === 1 ? 'break' : 'breaks'} today
          </Text>
        </View>
      )}

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
              skipNow();
              setSkipped(true);
            }}
          />
        )}
        {phase === 'done' && <Button title="Back to it" onPress={close} />}
        {phase === 'skipped' && <Button title="Back" variant="secondary" onPress={close} />}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { alignItems: 'center', justifyContent: 'center', gap: 24 },
  chip: { borderRadius: radius.m, paddingVertical: 10, paddingHorizontal: 18 },
  line: { maxWidth: 300 },
  actions: { alignSelf: 'stretch', gap: 12 },
});
