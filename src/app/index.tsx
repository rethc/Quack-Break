import { Redirect, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/Button';
import { Duck, ENTER_MS, type DuckMode } from '@/components/duck/Duck';
import { BEAK_FROM_CENTRE } from '@/components/duck/shapes';
import { GearIcon, IconButton } from '@/components/Icons';
import { DuckBubble } from '@/components/DuckBubble';
import { PondProgress, STAGE_SCALE } from '@/components/pond/PondProgress';
import { PondScene } from '@/components/PondScene';
import { Screen } from '@/components/Screen';
import { SkyClock } from '@/components/SkyClock';
import { Text } from '@/components/Text';
import {
  breakRunningLines,
  dueLines,
  pausedLines,
  pickFresh,
  quietLines,
  skipLines,
  snoozeLine,
  waitingLines,
} from '@/core/messages';
import { describeDuck, stageFor, unlockedItems } from '@/core/pond';
import { dayKey, MINUTE, nextQuietEnd, planBreaks } from '@/core/schedule';
import { useNow } from '@/hooks/useNow';
import { turnOnNotifications, usePermissions } from '@/hooks/usePermissions';
import { beginBreak, completeBreakIfDone, resumeNow, skipNow, snoozeNow } from '@/services/breaks';
import { openChannelSettings, requestExactAlarms } from '@/services/notifications';
import { haptic } from '@/services/haptics';
import { useData } from '@/services/storage';
import { space, useTheme } from '@/theme';
import { formatClock, formatCountdown, formatMinuteOfDay, nextMinuteChange, spokenCountdown } from '@/utils/format';

type Status = 'waiting' | 'due' | 'quiet' | 'break' | 'paused';

/** Height of the pond at the bottom of the sky panel. */
const POND_H = 230;
/** The sky panel, top to bottom: room for the sun at the arc's peak, the countdown, the bubble, the duck. */
const SUN_TOP = 34;
const STATUS_TOP = SUN_TOP + 30;
const BUBBLE_H = 74; // two lines
/** The duck at its full size (a pond legend); younger ducks are smaller. */
const DUCK_FULL = 156;
const MIN_SKY = 340;

export default function Home() {
  const onboarded = useData((d) => d.onboarded);
  if (!onboarded) return <Redirect href="/welcome" />;
  return <HomeScreen />;
}

function HomeScreen() {
  const { colors } = useTheme();
  const settings = useData((d) => d.settings);
  const timer = useData((d) => d.timer);
  const days = useData((d) => d.days);
  const pond = useData((d) => d.pond);
  const stage = stageFor(pond.total);
  const duckSize = Math.round(DUCK_FULL * STAGE_SCALE[stage.id]);
  // The bubble sits just above the duck's head, measured from the panel's bottom.
  const duckClear = duckSize + 6;
  const pondItems = useMemo(
    () =>
      unlockedItems(pond.total)
        .filter((i) => i.kind === 'pond')
        .map((i) => i.id),
    [pond.total],
  );

  const now = useNow((t) => {
    const p = planBreaks(t, settings, timer, { max: 1 });
    if (p.breakActive) return timer.breakEndsAt;
    if (timer.paused) return null;
    if (p.quietNow) return nextQuietEnd(t, settings.quiet);
    if (p.overdue) return null;
    return nextMinuteChange(p.dueAt, t);
  });

  const plan = planBreaks(now, settings, timer, { max: 1 });
  const status: Status = plan.breakActive
    ? 'break'
    : timer.paused
      ? 'paused'
      : plan.quietNow
        ? 'quiet'
        : plan.overdue
          ? 'due'
          : 'waiting';

  // A break that ran out while we were looking at this screen.
  useEffect(() => {
    if (timer.breakEndsAt !== null && timer.breakEndsAt <= now) completeBreakIfDone();
  }, [now, timer.breakEndsAt]);

  const [intro, setIntro] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setIntro(false), ENTER_MS + 200);
    return () => clearTimeout(id);
  }, []);

  // A short reaction (shrug) after Skip or Snooze, with its own line.
  const [reaction, setReaction] = useState<{ line: string } | null>(null);
  useEffect(() => {
    if (!reaction) return;
    const id = setTimeout(() => setReaction(null), 2600);
    return () => clearTimeout(id);
  }, [reaction]);

  const line = useMemo(() => {
    const lists = {
      waiting: waitingLines,
      due: dueLines,
      quiet: quietLines,
      break: breakRunningLines,
      paused: pausedLines,
    };
    return pickFresh(lists[status]);
  }, [status]);

  const duckMode: DuckMode = reaction
    ? 'shrug'
    : intro
      ? 'enter'
      : (
          {
            waiting: 'idle',
            due: 'attention',
            quiet: 'sleep',
            break: 'idle',
            paused: 'idle',
          } as const
        )[status];

  const today = days[dayKey(now)] ?? 0;
  const nextReminder = plan.reminders[0];

  // The sky clock: how far through the wait we are (moon/sun on the far right = break time).
  const skyProgress =
    status === 'waiting'
      ? Math.min(1, Math.max(0, 1 - (plan.dueAt - now) / (settings.workMin * MINUTE)))
      : status === 'due'
        ? 1
        : null;
  // The panel is only as tall as its contents, so the arc's peak sits near its top. The
  // buttons follow right under it; any spare height is left at the bottom.
  const [area, setArea] = useState({ w: 0, h: 0 });
  const { fontScale } = useWindowDimensions();
  const statusH = Math.ceil(48 * fontScale + 78 * Math.min(fontScale, 1.6) + 6);
  const fit = STATUS_TOP + statusH + 12 + BUBBLE_H + duckClear;
  const [footH, setFootH] = useState(0);
  // Never shorter than the countdown and the duck need (large text on a small phone scrolls).
  const skyH = Math.max(MIN_SKY, fit - BUBBLE_H, Math.min(fit, area.h - footH - space.m));
  // On a short screen the bubble goes first, to leave the countdown room.
  const showBubble = skyH >= fit - 1;
  const statusHeight = Math.max(0, skyH - duckClear - (showBubble ? BUBBLE_H : 0) - 12 - STATUS_TOP);
  // The arc's ends sit above the reed tops, so the sun or moon is never half hidden.
  const arcBase = skyH - POND_H * 0.4 - 70;
  // The bubble is centred over the duck, with the same room at both sides: enough that the sun
  // or moon, resting at the end of its arc, never touches even a long line. Its tail sits over the beak.
  const BUBBLE_SIDE = 60;

  const start = () => {
    haptic.tap();
    beginBreak();
    router.push('/break');
  };

  return (
    <Screen>
      <View style={styles.header}>
        <Text variant="title" style={[styles.flex, styles.appName]}>
          Quack Break
        </Text>
        <IconButton label="Settings" onPress={() => router.push('/settings')}>
          {(c) => <GearIcon color={c} />}
        </IconButton>
      </View>

      <ReminderWarning />

      <View
        style={styles.area}
        onLayout={(e) =>
          setArea({
            w: e.nativeEvent.layout.width,
            h: e.nativeEvent.layout.height,
          })
        }
      >
        <View style={[styles.sky, { height: skyH, backgroundColor: colors.heroSky }]}>
          <SkyClock width={area.w} height={skyH} progress={skyProgress} baseY={arcBase} topY={SUN_TOP} />

          <View
            style={[styles.status, { top: STATUS_TOP, height: statusHeight }]}
            accessible
            accessibilityLabel={statusLabel(status, plan.dueAt - now, nextReminder, settings.quiet.endMin)}
          >
            {status === 'waiting' && (
              <>
                <Text variant="body" soft center>
                  Next break in
                </Text>
                <Text variant="display" center style={styles.countdown} numberOfLines={1} adjustsFontSizeToFit>
                  {formatCountdown(plan.dueAt - now)}
                </Text>
                <Text variant="body" soft center>
                  at {formatClock(plan.dueAt)}
                </Text>
              </>
            )}
            {status === 'due' && (
              <>
                <Text variant="display" center style={styles.dueTitle} numberOfLines={1} adjustsFontSizeToFit>
                  Break time
                </Text>
                <Text variant="body" soft center>
                  Look far away for {settings.breakSec} seconds.
                </Text>
              </>
            )}
            {status === 'quiet' && (
              <>
                <Text variant="title" center>
                  Quiet hours
                </Text>
                <Text variant="body" soft center>
                  {nextReminder ? `Next reminder at ${formatClock(nextReminder)}` : 'Reminders paused'}
                </Text>
              </>
            )}
            {status === 'break' && (
              <Text variant="title" center>
                Break in progress
              </Text>
            )}
            {status === 'paused' && (
              <>
                <Text variant="title" center>
                  Reminders stopped
                </Text>
                <Text variant="body" soft center>
                  Resume when you&apos;re ready.
                </Text>
              </>
            )}
          </View>

          <View style={styles.pond}>
            <PondScene height={POND_H} sky={false} items={pondItems}>
              <Duck mode={duckMode} size={duckSize} stage={stage.id} wearing={pond.wearing} who={describeDuck(pond)} />
            </PondScene>
          </View>

          {showBubble && (
            <DuckBubble
              text={reaction?.line ?? line}
              tailOffset={Math.round(duckSize * BEAK_FROM_CENTRE)}
              style={{ ...styles.bubble, bottom: duckClear, left: BUBBLE_SIDE, right: BUBBLE_SIDE }}
            />
          )}
        </View>

        <View style={styles.foot} onLayout={(e) => setFootH(e.nativeEvent.layout.height)}>
          <View style={styles.actions}>
            {status === 'waiting' && <Button title="Take a break now" onPress={start} />}
            {status === 'quiet' && <Button title="Take a break anyway" variant="secondary" onPress={start} />}
            {status === 'break' && <Button title="Back to my break" onPress={() => router.push('/break')} />}
            {status === 'paused' && (
              <>
                <Button
                  title="Resume reminders"
                  onPress={() => {
                    haptic.tap();
                    resumeNow();
                  }}
                />
                <Button title="Take a break now" variant="secondary" onPress={start} />
              </>
            )}
            {status === 'due' && (
              <>
                <Button title="Start break" onPress={start} />
                <View style={styles.row}>
                  <Button
                    title={`Snooze ${settings.snoozeMin} min`}
                    variant="secondary"
                    style={styles.flex}
                    onPress={() => {
                      haptic.soft();
                      snoozeNow();
                      setReaction({
                        line: snoozeLine(settings.snoozeMin),
                      });
                    }}
                  />
                  <Button
                    title="Skip"
                    variant="secondary"
                    style={styles.flex}
                    onPress={() => {
                      haptic.soft();
                      skipNow();
                      setReaction({ line: pickFresh(skipLines) });
                    }}
                  />
                </View>
              </>
            )}
          </View>

          <PondProgress pond={pond} today={today} />
        </View>
      </View>
    </Screen>
  );
}

/** Shown only when reminders can't reach the user, with the one tap that fixes it. */
function ReminderWarning() {
  const { colors } = useTheme();
  const perms = usePermissions();
  const warning = !perms.notifications
    ? {
        title: 'Notifications are off',
        body: "You won't get break reminders.",
        action: 'Turn on',
        fix: async () => {
          await turnOnNotifications();
          perms.refresh();
        },
      }
    : !perms.channel
      ? {
          title: 'Break reminders are off',
          body: "They're turned off in your phone's notification settings.",
          action: 'Turn on',
          fix: async () => {
            await openChannelSettings('start');
            perms.refresh();
          },
        }
      : !perms.exact
        ? {
            title: 'Reminders may run late',
            body: 'Allow on-time reminders so they arrive while your phone is idle.',
            action: 'Allow',
            fix: async () => {
              await requestExactAlarms();
              perms.refresh();
            },
          }
        : null;
  if (!warning) return null;
  return (
    <Pressable
      onPress={() => warning.fix().catch((e) => console.warn('Could not open settings', e))}
      accessibilityRole="button"
      accessibilityLabel={`${warning.title}. ${warning.body}`}
      accessibilityHint={warning.action}
      style={({ pressed }) => [styles.warning, { backgroundColor: colors.card }, pressed && { opacity: 0.8 }]}
    >
      <View style={styles.warningText}>
        <Text variant="label" color={colors.warn}>
          {warning.title}
        </Text>
        <Text variant="small" soft>
          {warning.body}
        </Text>
      </View>
      <Text variant="label" color={colors.accentText}>
        {warning.action}
      </Text>
    </Pressable>
  );
}

function statusLabel(status: Status, msLeft: number, nextReminder: number | undefined, quietEndMin: number) {
  switch (status) {
    case 'waiting':
      return `Next eye break in ${spokenCountdown(msLeft)}`;
    case 'due':
      return 'Break time';
    case 'quiet':
      return nextReminder
        ? `Quiet hours. Next reminder at ${formatClock(nextReminder)}`
        : `Quiet hours until ${formatMinuteOfDay(quietEndMin)}`;
    case 'break':
      return 'Break in progress';
    case 'paused':
      return 'Reminders stopped';
  }
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  warningText: { flex: 1, gap: 2 },
  appName: { fontSize: 26, lineHeight: 32 },
  flex: { flex: 1, minWidth: 140 },
  // Grows to fill the screen, but never shrinks below its contents (the page scrolls instead).
  area: { flexGrow: 1, gap: space.m },
  foot: { gap: space.m },
  sky: { borderRadius: 32, overflow: 'hidden' },
  status: {
    position: 'absolute',
    left: 40,
    right: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  countdown: { fontSize: 72, lineHeight: 78 },
  // Wider than the countdown, so a little smaller to stay inside the arc.
  dueTitle: { fontSize: 46, lineHeight: 54 },
  pond: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bubble: { position: 'absolute' },
  actions: { gap: 12 },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
});
