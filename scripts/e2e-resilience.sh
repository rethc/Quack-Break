#!/usr/bin/env bash
# Resilience checks on an Android EMULATOR: reminders survive a reboot, a force-stop and an app
# update, and thousands of random taps (Android's "monkey") don't crash the app.
#
#   ANDROID_SERIAL=emulator-5554 DEV_APK=path/to/dev.apk RELEASE_APK=path/to/release.apk \
#     bash scripts/e2e-resilience.sh
#
# It reboots the device and installs builds: run it only on an emulator, never on a phone you use.
# The development build part needs the dev server (npx expo start --dev-client --port 8081).
set -u
# Git Bash on Windows would rewrite device paths like /sdcard into Windows paths.
export MSYS_NO_PATHCONV=1
ADB="${ADB:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}"
P=com.chesd.quackbreak
OUT="${E2E_OUT:-${TMPDIR:-/tmp}/quack-e2e}"
MONKEY_EVENTS="${MONKEY_EVENTS:-5000}"
mkdir -p "$OUT"
DEV_URL="exp+quack-break://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
PASS=0
FAIL=0
FAILED=()

a() { "$ADB" "$@"; }
sh_() { "$ADB" shell "$@" | tr -d '\r'; }
alarm_count() { sh_ dumpsys alarm | grep -c "Alarm{.*$P}"; }
notif_titles() { sh_ dumpsys notification --noredact | awk -v p="$P" '/NotificationRecord\(/ {cur=($0 ~ "pkg=" p)} cur && /android\.title=/ {sub(/.*android\.title=[A-Za-z]* ?\(?/,""); sub(/\)$/,""); print}'; }
tray_has() { notif_titles | grep -q -- "$1"; }
refill_booked() { sh_ dumpsys alarm | grep -q "quacktimer.REFILL"; }
ge() { [ "$1" -ge "$2" ]; }
eq() { [ "$1" = "$2" ]; }
check() {
  local name="$1"
  shift
  if "$@"; then
    PASS=$((PASS + 1))
    echo "PASS  $name"
  else
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
    echo "FAIL  $name"
    a exec-out screencap -p >"$OUT/resilience-fail-$((PASS + FAIL)).png"
  fi
}
wait_boot() {
  local i
  a wait-for-device
  for i in $(seq 1 90); do
    [ "$(sh_ getprop sys.boot_completed)" = "1" ] && return 0
    sleep 2
  done
  return 1
}
wait_alarms() { # at least N of our alarms within T seconds
  local end=$((SECONDS + $2))
  while [ $SECONDS -lt $end ]; do
    [ "$(alarm_count)" -ge "$1" ] && return 0
    sleep 2
  done
  return 1
}
# The development launcher crashes ("App react context shouldn't be created before") when asked to
# load while the app is already running, so a running app is closed first (without a force-stop,
# which would clear the alarms being checked).
open_dev() {
  if [ -n "$(sh_ pidof $P)" ]; then
    a shell input keyevent 3
    sleep 1
    a shell am kill $P
    sleep 1
  fi
  a reverse tcp:8081 tcp:8081 >/dev/null
  a shell am start -a android.intent.action.VIEW -d "$DEV_URL" >/dev/null 2>&1
  sleep "${1:-12}"
}

echo "Resilience checks on $(sh_ getprop ro.product.model) (Android $(sh_ getprop ro.build.version.release))"
sh_ svc power stayon true

# The app must be set up (onboarded, notifications allowed) with reminders booked.
open_dev 15
before=$(alarm_count)
check "starting point: reminders booked" ge "$before" 100
check "starting point: tray timer" tray_has "Next break"

# ---------- Reboot ----------
a reboot
check "reboot: device back" wait_boot
sleep 20
check "reboot: reminders still booked (expo re-arms them)" wait_alarms 100 60
check "reboot: tray timer back without opening the app" tray_has "Next break"
check "reboot: background top-up still booked" refill_booked

# ---------- Force-stop ----------
a shell am force-stop $P
sleep 2
check "force-stop: Android clears the app's alarms" eq "$(alarm_count)" 0
open_dev 15
check "force-stop: opening the app books everything again" wait_alarms 100 40
check "force-stop: tray timer back" tray_has "Next break"

# ---------- App update ----------
if [ -n "${DEV_APK:-}" ]; then
  a install -r "$DEV_APK" >/dev/null
  sleep 15
  check "update: reminders still booked after an update" wait_alarms 100 60
  check "update: tray timer back after an update" tray_has "Next break"
fi

# ---------- Monkey: random taps on the release build ----------
if [ -n "${RELEASE_APK:-}" ]; then
  check "monkey: release build installed over the development build" bash -c "'$ADB' install -r '$RELEASE_APK' 2>&1 | grep -q Success"
  check "monkey: the installed build is the release build" bash -c "! '$ADB' shell dumpsys package $P | grep -q 'flags=.*DEBUGGABLE'"
  a logcat -c
  a shell am start -n $P/.MainActivity >/dev/null
  sleep 5
  # Only this app; no system keys (they'd leave the app), a little throttle so animations run.
  a shell monkey -p $P --pct-syskeys 0 --pct-appswitch 0 --pct-flip 0 --throttle 60 -s 4242 -v "$MONKEY_EVENTS" >"$OUT/monkey.log" 2>&1
  check "monkey: finished all $MONKEY_EVENTS events" grep -q "Events injected: $MONKEY_EVENTS" "$OUT/monkey.log"
  # Monkey reports an app crash as '// CRASH: <package>' with a '// Short Msg' line.
  check "monkey: no crash" bash -c "! grep -qE '^// (CRASH|Short Msg)' '$OUT/monkey.log'"
  check "monkey: no app-not-responding" bash -c "! grep -q 'NOT RESPONDING' '$OUT/monkey.log'"
  a logcat -d >"$OUT/monkey-logcat.txt"
  check "monkey: no fatal errors in the log" bash -c "! grep -E 'FATAL EXCEPTION|ReactNativeJS.*(Error|TypeError)' '$OUT/monkey-logcat.txt' | grep -q ."
  check "monkey: app still running" bash -c "'$ADB' shell pidof $P | grep -q ."
  check "monkey: reminders still booked" ge "$(alarm_count)" 1
  if [ -n "${DEV_APK:-}" ]; then a install -r "$DEV_APK" >/dev/null; fi
fi

sh_ svc power stayon false
echo
echo "$PASS passed, $FAIL failed"
for f in "${FAILED[@]}"; do echo "  failed: $f"; done
[ "$FAIL" -eq 0 ]
