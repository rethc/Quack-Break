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
  const breakSec = useData((d) => d.settings.breakSec);
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
            {`Every ${workMin} minutes I'll remind you to look at something about 20 feet (6 m) away for ${breakSec} seconds. It's called the 20-20-20 rule, and your eyes will thank you.`}
          </Text>
          <Text variant="body" soft>
            {"Skipped one? No problem. I'll just shrug."}
          </Text>
          <Button title="Allow reminders" icon="🔔" onPress={allow} />
        </View>
      )}

      {step === 'exact' && (
        <View style={styles.block}>
          <Text variant="title">Stay on time</Text>
          <Text variant="body">
            To save battery, Android can hold reminders back while your phone sits idle. Turning on{' '}
            <Text variant="label">Alarms &amp; reminders</Text> for Quack Break lets me quack right on time.
          </Text>
          <Button title="Open the setting" onPress={() => void requestExactAlarms()} />
          <Button title="Maybe later" variant="ghost" onPress={() => setStep('ready')} />
        </View>
      )}

      {step === 'ready' && (
        <View style={styles.block}>
          <Text variant="title">{allowed ? 'Ready when you are' : 'Reminders are off'}</Text>
          <Text variant="body">
            {allowed
              ? `Your first reminder comes in ${workMin} minutes. You can change times, quiet hours and sounds in Settings.`
              : 'You can turn reminders on later in Settings. While the app is open, I still keep time.'}
          </Text>
          <Button title="Let's go!" onPress={finish} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  block: { gap: 14 },
});
