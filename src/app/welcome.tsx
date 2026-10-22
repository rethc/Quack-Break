import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Duck, ENTER_MS, type DuckMode } from '@/components/duck/Duck';
import { PondScene } from '@/components/PondScene';
import { Screen } from '@/components/Screen';
import { SpeechBubble } from '@/components/SpeechBubble';
import { Text } from '@/components/Text';
import { finishOnboarding } from '@/core/transitions';
import { haptic } from '@/services/haptics';
import {
  hasExactAlarms,
  needsExactAlarmPermission,
  requestExactAlarms,
  requestNotificationPermission,
  syncSchedule,
} from '@/services/notifications';
import { updateData, useData } from '@/services/storage';

type Step = 'hello' | 'exact' | 'ready';

export default function Welcome() {
  const workMin = useData((d) => d.settings.workMin);
  const [step, setStep] = useState<Step>('hello');
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<DuckMode>('enter');

  useEffect(() => {
    const id = setTimeout(() => setMode('idle'), ENTER_MS + 200);
    return () => clearTimeout(id);
  }, []);

  // Coming back from Android's "Alarms & reminders" screen.
  useEffect(() => {
    if (step !== 'exact') return;
    const sub = AppState.addEventListener('change', async (s) => {
      if (s === 'active' && (await hasExactAlarms())) setStep('ready');
    });
    return () => sub.remove();
  }, [step]);

  const allow = async () => {
    haptic.tap();
    const ok = await requestNotificationPermission();
    setAllowed(ok);
    if (ok && needsExactAlarmPermission && !(await hasExactAlarms())) setStep('exact');
    else setStep('ready');
  };

  const finish = () => {
    haptic.success();
    updateData((d) => finishOnboarding(d, Date.now()));
    void syncSchedule();
    router.replace('/');
  };

  const bubble =
    step === 'hello'
      ? "Hi! I'm your break duck 🦆"
      : step === 'exact'
        ? 'One more thing, so I can be on time.'
        : allowed
          ? 'All set! I quack, you look far away.'
          : "No reminders for now. That's okay!";

  return (
    <Screen>
      <SpeechBubble text={bubble} />
      <PondScene height={210}>
        <Duck mode={step === 'ready' && allowed ? 'flap' : mode} size={150} />
      </PondScene>

      {step === 'hello' && (
        <View style={styles.block}>
          <Text variant="title">Rest your eyes, one quack at a time</Text>
          <Text variant="body">
            The 20-20-20 rule: every 20 minutes, look at something 20 feet (6 m) away for 20 seconds. I&apos;ll
            remind you.
          </Text>
          <Text variant="body" soft>
            Want different timing? You can change it in Settings.
          </Text>
          <Button title="Allow reminders" onPress={allow} />
        </View>
      )}

      {step === 'exact' && (
        <View style={styles.block}>
          <Text variant="title">Stay on time</Text>
          <Text variant="body">
            Android can delay reminders to save battery. Turn on <Text variant="label">Alarms &amp; reminders</Text>{' '}
            so they arrive on time.
          </Text>
          <Button title="Open settings" onPress={() => void requestExactAlarms()} />
          <Button title="Not now" variant="ghost" onPress={() => setStep('ready')} />
        </View>
      )}

      {step === 'ready' && (
        <View style={styles.block}>
          <Text variant="title">{allowed ? "You're all set" : 'Reminders are off'}</Text>
          <Text variant="body">
            {allowed
              ? `First reminder in ${workMin} minutes.`
              : 'You can turn them on later in Settings.'}
          </Text>
          <Button title="Start" onPress={finish} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: 14 },
});
