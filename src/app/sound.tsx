// Pick the sound for one alert (?moment=start for the break reminder, end for break over).
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { BackIcon, IconButton } from '@/components/Icons';
import { Screen } from '@/components/Screen';
import { Card, CardBlock, ChoiceRow, RadioRow } from '@/components/SettingRows';
import { Text } from '@/components/Text';
import { ANDROID_ONLY_SOUNDS, SOUND_OPTIONS, VOICE_OPTIONS, type Moment } from '@/core/sounds';
import type { SoundId } from '@/core/types';
import { openChannelSettings, previewMoment, stopPreview, syncSchedule } from '@/services/notifications';
import { saveSettings } from '@/services/settings';
import { useData } from '@/services/storage';

const SOUNDS = SOUND_OPTIONS.filter((o) => Platform.OS === 'android' || !ANDROID_ONLY_SOUNDS.includes(o.value));

export default function SoundScreen() {
  const params = useLocalSearchParams<{ moment?: string }>();
  const moment: Moment = params.moment === 'end' ? 'end' : 'start';
  const key = moment === 'start' ? 'startSound' : 'endSound';
  const s = useData((d) => d.settings);
  const current = s[key];

  // When leaving: stop any preview, and rebook reminders with the new sound once.
  useEffect(
    () => () => {
      stopPreview();
      void syncSchedule();
    },
    [],
  );

  // Choosing plays the sound; choosing the same one again replays it.
  const pick = (v: SoundId) => {
    saveSettings({ [key]: v }, { sync: false });
    previewMoment(moment).catch((e) => console.warn('Could not play the preview', e));
  };

  return (
    <Screen>
      <View style={styles.header}>
        <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/settings'))}>
          {(c) => <BackIcon color={c} />}
        </IconButton>
        <Text variant="title" style={styles.flex}>
          {moment === 'start' ? 'Reminder sound' : 'Break over sound'}
        </Text>
      </View>

      <Card>
        {SOUNDS.map((o) => (
          <RadioRow key={o.value} label={o.label} selected={o.value === current} onPress={() => pick(o.value)} />
        ))}
      </Card>

      {current === 'voice' && (
        <Card title="Voice">
          <ChoiceRow
            label={moment === 'start' ? 'Says “Time to rest”' : 'Says “Time to work”'}
            value={s.voice}
            options={VOICE_OPTIONS}
            columns={4}
            onChange={(v) => {
              saveSettings({ voice: v }, { sync: false });
              previewMoment(moment).catch((e) => console.warn('Could not play the preview', e));
            }}
          />
        </Card>
      )}

      {Platform.OS === 'android' && current === 'phone' && (
        <Card>
          <CardBlock>
            <Text variant="body">Use any ringtone or notification sound on your phone.</Text>
            <Button
              title="Choose phone sound"
              variant="secondary"
              onPress={() => openChannelSettings(moment).catch((e) => console.warn('Could not open settings', e))}
            />
          </CardBlock>
        </Card>
      )}

      <Text variant="small" soft center>
        Tap a sound to hear it. Sounds follow your phone&apos;s volume and silent mode.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
