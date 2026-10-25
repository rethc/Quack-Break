#!/usr/bin/env bash
# End-to-end checks on an Android emulator, driving the real app like a person would.
#
# Needs: a running emulator (adb device), the development build installed, the dev server
# running (npx expo start --dev-client --port 8081), and Node. Run from the repo root:
#   ANDROID_SERIAL=emulator-5554 bash scripts/e2e-android.sh
# It CLEARS the app's data first. Never point it at a phone you use: it taps the notification
# shade by position and changes system settings (time zone, text size, permissions).
set -u
# Git Bash on Windows would rewrite device paths like /sdcard into Windows paths.
export MSYS_NO_PATHCONV=1
ADB="${ADB:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}"
P=com.chesd.quackbreak
OUT="${E2E_OUT:-${TMPDIR:-/tmp}/quack-e2e}"
mkdir -p "$OUT"
DEV_URL="exp+quack-break://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"
PASS=0
FAIL=0
FAILED=()
# Quiet hours a few hours away from now, so results don't depend on the time of day the run starts.
QUIET_AWAY='const n=new Date();const m=n.getHours()*60+n.getMinutes();const s=(Math.floor(m/30)*30+180)%1440;d.settings.quiet={enabled:true,startMin:s,endMin:(s+60)%1440}'

a() { "$ADB" "$@"; }
sh_() { "$ADB" shell "$@" | tr -d '\r'; }

# --- screen reading --------------------------------------------------------------------------
# `uiautomator dump` waits for a second without changes on screen first, and a ticking countdown
# (a running break, the tray timer) never gives it one: a read there took 10 s or failed. So the
# screen is read with scripts/QuackDump.java instead, built here with the Android SDK's javac and
# d8, and read twice to know it has settled. Without a JDK, the slow reader is used.
QUICK_DUMP=0
setup_quick_dump() {
  local sdk="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}" jdk="${JAVA_HOME_FOR_E2E:-/c/Program Files/Android/Android Studio/jbr}"
  local plat bt dir="$OUT/quickdump" w
  plat=$(ls -d "$sdk"/platforms/android-* 2>/dev/null | sort -V | tail -1)
  bt=$(ls -d "$sdk"/build-tools/* 2>/dev/null | sort -V | tail -1)
  [ -f "$plat/uiautomator.jar" ] && [ -f "$bt/lib/d8.jar" ] && [ -x "$jdk/bin/javac" -o -x "$jdk/bin/javac.exe" ] || return 1
  w() { cygpath -w "$1" 2>/dev/null || echo "$1"; }
  local cp="$(w "$plat/android.jar");$(w "$plat/uiautomator.jar");$(w "$plat/optional/android.test.base.jar")"
  rm -rf "$dir" && mkdir -p "$dir/classes" || return 1
  "$jdk/bin/javac" --release 8 -nowarn -cp "$cp" -d "$(w "$dir/classes")" "$(w scripts/QuackDump.java)" >/dev/null 2>&1 || return 1
  (cd "$dir/classes" && "$jdk/bin/java" -cp "$(w "$bt/lib/d8.jar")" com.android.tools.r8.D8 --min-api 24 \
    --lib "$(w "$plat/android.jar")" --classpath "$(w "$plat/uiautomator.jar")" \
    --classpath "$(w "$plat/optional/android.test.base.jar")" --output "$(w "$dir/quackdump.jar")" QuackDump.class >/dev/null 2>&1) || return 1
  [ -f "$dir/quackdump.jar" ] && "$ADB" push "$dir/quackdump.jar" /data/local/tmp/quackdump.jar >/dev/null 2>&1 || return 1
  "$ADB" shell mkdir -p /data/local/tmp/local/tmp
  # It needs something on screen to read: wake the screen and give it a few tries.
  local i
  for i in 1 2 3 4 5; do
    [ -n "$(quick_read)" ] && QUICK_DUMP=1 && return 0
    "$ADB" shell input keyevent KEYCODE_WAKEUP
    "$ADB" shell wm dismiss-keyguard >/dev/null 2>&1
    sleep 1
  done
  echo "note: the quick screen reader was built but reads nothing; using uiautomator dump (slow on countdowns)" >&2
  return 0
}
quick_read() { # the screen right now, without waiting for it to be still
  "$ADB" shell "rm -f /data/local/tmp/local/tmp/quack-ui.xml; uiautomator runtest quackdump.jar /system/framework/android.test.base.jar -c QuackDump >/dev/null 2>&1; cat /data/local/tmp/local/tmp/quack-ui.xml 2>/dev/null" | tr -d '\r' | grep "<node"
}
raw_dump() {
  local i
  if [ "$QUICK_DUMP" = 1 ]; then
    # Settled when two reads in a row match, numbers aside (countdowns tick, things move).
    local prev="" cur=""
    for i in 1 2 3 4 5 6 7 8; do
      cur=$(quick_read)
      if [ -n "$cur" ] && [ -n "$prev" ] && [ "$(printf '%s' "$cur" | tr -d '0-9')" = "$(printf '%s' "$prev" | tr -d '0-9')" ]; then break; fi
      [ -n "$cur" ] && prev=$cur
      sleep 0.3
    done
    printf '%s' "${cur:-$prev}" >"$OUT/ui.xml"
    grep -q "<node" "$OUT/ui.xml"
    return
  fi
  # uiautomator fails now and then without saying so: remove the old file first, and retry
  # until a real reading comes back, so a stale screen is never mistaken for the current one.
  for i in 1 2 3 4 5 6; do
    "$ADB" shell rm -f /sdcard/e2e.xml
    "$ADB" shell uiautomator dump /sdcard/e2e.xml >/dev/null 2>&1
    "$ADB" shell cat /sdcard/e2e.xml 2>/dev/null | tr -d '\r' >"$OUT/ui.xml"
    grep -q "<node" "$OUT/ui.xml" && return 0
    sleep 1
  done
  return 1
}
# Read the screen. The development build shows its own menu intro once after a fresh install,
# sometimes seconds late: close it whenever it turns up, so it never covers the app.
dump() {
  raw_dump
  # Another app's crash or "not responding" dialog (common on a freshly booted emulator, e.g.
  # "Bluetooth keeps stopping") covers the app: close it. One about Quack Break is left on
  # screen, so the check fails and the screenshot shows it.
  local i
  for i in 1 2 3; do
    grep -qE "keeps stopping|isn(&#39;|&apos;|')t responding" "$OUT/ui.xml" || break
    grep -qE "Quack Break (keeps stopping|isn)" "$OUT/ui.xml" && break
    echo "note: closed another app's dialog: $(labels | head -1)" >&2
    local close
    close=$(center_of "Close app")
    # shellcheck disable=SC2086
    if [ -n "$close" ]; then "$ADB" shell input tap $close; else "$ADB" shell input keyevent 4; fi
    sleep 2
    raw_dump
  done
  if grep -q "This is the developer menu" "$OUT/ui.xml"; then
    local xy
    xy=$(center_of "Continue")
    # shellcheck disable=SC2086
    [ -n "$xy" ] && "$ADB" shell input tap $xy
    sleep 1
    "$ADB" shell input keyevent 4
    sleep 2
    raw_dump
  fi
}
# Labels and texts on screen, one per line ("&#10;" etc. decoded enough for matching).
labels() {
  node -e '
    const x = require("fs").readFileSync(process.argv[1], "utf8");
    const dec = (s) => s.replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#39;/g, "'"'"'").replace(/&apos;/g, "'"'"'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, " ");
    for (const m of x.matchAll(/<node [^>]*>/g)) {
      const n = m[0], g = (k) => dec((n.match(new RegExp(k + "=\"([^\"]*)\"")) || [])[1] || "");
      for (const t of [g("text"), g("content-desc")]) if (t) console.log(t);
    }' "$OUT/ui.xml"
}
# True if some text or label on screen contains $1.
on_screen() { dump && labels | grep -qF -- "$1"; }
# For brief states (a 2.6 s reaction on Home): any single reading counts, without waiting for the
# screen to settle, which can take most of that time.
glimpse() { # text timeout_s
  local end=$((SECONDS + ${2:-3}))
  while [ $SECONDS -lt $end ]; do
    if [ "$QUICK_DUMP" = 1 ]; then quick_read >"$OUT/ui.xml"; else raw_dump; fi
    labels | grep -qF -- "$1" && return 0
  done
  return 1
}
# Android cancels alarms a moment after the app asks (the Stop runs in the background).
alarms_cleared() { # timeout_s
  local end=$((SECONDS + ${1:-20}))
  while [ $SECONDS -lt $end ]; do
    [ "$(alarm_count)" -eq 0 ] && return 0
    sleep 1
  done
  return 1
}
wait_for() { # text timeout_s
  local end=$((SECONDS + ${2:-15}))
  while [ $SECONDS -lt $end ]; do on_screen "$1" && return 0; sleep 1; done
  return 1
}
center_of() { # text -> "x y" of the first node whose text or label contains it
  node -e '
    const x = require("fs").readFileSync(process.argv[1], "utf8"), want = process.argv[2];
    const dec = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'"'"'").replace(/&apos;/g, "'"'"'").replace(/&quot;/g, "\"").replace(/&#10;/g, " ");
    for (const m of x.matchAll(/<node [^>]*>/g)) {
      const n = m[0], g = (k) => dec((n.match(new RegExp(k + "=\"([^\"]*)\"")) || [])[1] || "");
      if (g("text") === want || g("content-desc") === want) {
        const b = g("bounds").match(/\d+/g).map(Number);
        console.log(((b[0] + b[2]) >> 1) + " " + ((b[1] + b[3]) >> 1));
        process.exit(0);
      }
    }' "$OUT/ui.xml" "$1"
}
tap() { # exact text or label
  dump
  local xy
  xy=$(center_of "$1")
  [ -n "$xy" ] || return 1
  # shellcheck disable=SC2086
  a shell input tap $xy
}
back() { a shell input keyevent 4; }
# A letter at a time: a burst from `input text` is faster than any typist, and the development
# build drops letters typed that fast into a text box.
type_slowly() {
  local i
  for ((i = 0; i < ${#1}; i++)); do
    a shell input text "${1:i:1}"
    sleep 0.2
  done
}
# Home is the only screen titled "Quack Break". Back is pressed only while elsewhere, so the app
# is never left by mistake (and a check then passes on the launcher by accident).
on_home() { dump && labels | grep -qx "Quack Break"; }
back_to_home() {
  local i
  for i in 1 2 3; do
    on_home && return 0
    back
    sleep 1
  done
  on_home
}
home_key() { a shell input keyevent 3; }
shot() { a exec-out screencap -p >"$OUT/$1.png"; }

# --- app control -----------------------------------------------------------------------------
# Opens the app from the dev server. The development launcher crashes ("App react context
# shouldn't be created before") when asked to load while the app is already running, on screen or
# in the background, so a running app is closed first.
open_app() {
  a shell cmd statusbar collapse >/dev/null 2>&1
  a reverse tcp:8081 tcp:8081 >/dev/null
  if [ -n "$(sh_ pidof $P)" ]; then
    home_key
    sleep 1
    a shell am kill $P
    sleep 1
    if [ -n "$(sh_ pidof $P)" ]; then
      echo "note: the app kept running in the background; force-stopping it before opening" >&2
      a shell am force-stop $P
      sleep 1
    fi
  fi
  a shell am start -a android.intent.action.VIEW -d "$DEV_URL" >/dev/null 2>&1
  # Loading from the dev server takes a varying time: wait for the app's screen, then a little
  # more for its start-up work (booking reminders).
  local end=$((SECONDS + 45))
  while [ $SECONDS -lt $end ]; do
    dump && labels | grep -qE '^(Quack Break|Give your eyes regular breaks|Look far away|Your pond)' && break
    sleep 1
  done
  sleep "${1:-4}"
}
close_app() { home_key; sleep 1; a shell am kill $P; sleep 1; }
# Edit the saved state with a JS snippet on `d` (app must be in the background).
setstate() {
  sh_ run-as $P cat files/quack-state.json >"$OUT/state.json"
  # A missing or unreadable state (an earlier step failed) is reported, never replaced by junk.
  node -e 'const fs=require("fs"),p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));'"$1"';fs.writeFileSync(p,JSON.stringify(d))' "$OUT/state.json" 2>/dev/null ||
    { echo "note: could not edit the saved state (none saved yet?)" >&2; return 1; }
  a push "$OUT/state.json" /data/local/tmp/e2e-state.json >/dev/null
  sh_ chmod 644 /data/local/tmp/e2e-state.json
  sh_ run-as $P cp /data/local/tmp/e2e-state.json files/quack-state.json
}
state_js() { # print the value of a JS expression on the saved state `d`
  sh_ run-as $P cat files/quack-state.json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify('"$1"'))'
}
alarm_count() { sh_ dumpsys alarm | grep -c "Alarm{.*$P}"; }
notif_titles() { sh_ dumpsys notification --noredact | awk -v p="$P" '/NotificationRecord\(/ {cur=($0 ~ "pkg=" p)} cur && /android\.title=/ {sub(/.*android\.title=[A-Za-z]* ?\(?/,""); sub(/\)$/,""); print}'; }
tray_has() { notif_titles | grep -q -- "$1"; }
tray_is() { notif_titles | grep -qx -- "$1"; }
exact_alarms() { sh_ dumpsys alarm | grep -A3 "Alarm{.*$P}" | grep -q 'exactAllowReason=permission'; }
# The newest sound the app started, from Android's audio log (players are numbered in order), or 0.
# Works for sounds too short to still be playing when checked.
last_sound() {
  sh_ dumpsys audio | awk -v p="package:$P " '
    /new player piid:/ { match($0, /piid:[0-9]+/); id = substr($0, RSTART + 5, RLENGTH - 5) + 0; if (index($0, p)) mine[id] = 1 }
    /player piid:[0-9]+ event:started/ { match($0, /piid:[0-9]+/); id = substr($0, RSTART + 5, RLENGTH - 5) + 0; if (mine[id] && id > last) last = id }
    END { print last + 0 }'
}
sound_started_since() { [ "$(last_sound)" -gt "$1" ]; }
expand_shade() { a shell cmd statusbar expand-notifications; sleep 2; }
# "x y" of a button on the app's notification in the open shade. A notification below others
# shows collapsed, without its buttons: its own expand arrow is tapped first (never its text,
# which would open the app).
tray_action() {
  local xy i
  for i in 1 2; do
    dump
    xy=$(center_of "$1")
    [ -n "$xy" ] && { echo "$xy"; return 0; }
    xy=$(node -e '
      const x = require("fs").readFileSync(process.argv[1], "utf8"), p = process.argv[2];
      const nodes = [...x.matchAll(/<node [^>]*>/g)].map((m) => m[0]);
      const box = (n) => (n.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []).slice(1).map(Number);
      const mine = nodes.find((n) => n.includes(`resource-id="${p}:id/`));
      if (!mine) process.exit(0);
      const b = box(mine), y = (b[1] + b[3]) >> 1;
      for (const n of nodes) {
        if (!n.includes(`resource-id="android:id/expand_button"`)) continue;
        const e = box(n);
        if (e[1] <= y && y <= e[3]) { console.log(((e[0] + e[2]) >> 1) + " " + y); break; }
      }' "$OUT/ui.xml" "$P")
    # shellcheck disable=SC2086
    [ -n "$xy" ] && a shell input tap $xy && sleep 1
  done
  return 1
}
collapse_shade() { a shell cmd statusbar collapse; sleep 1; }

# --- reporting -------------------------------------------------------------------------------
check() { # name, then a command that succeeds when the check passes
  local name="$1"
  shift
  if "$@"; then
    PASS=$((PASS + 1))
    echo "PASS  $name"
  else
    FAIL=$((FAIL + 1))
    FAILED+=("$name")
    echo "FAIL  $name"
    shot "fail-$((PASS + FAIL))"
  fi
}
not() { ! "$@"; }
eq() { [ "$1" = "$2" ]; }
ge() { [ "$1" -ge "$2" ]; }

# ==============================================================================================
echo "Quack Break end-to-end checks on $(sh_ getprop ro.product.model) (Android $(sh_ getprop ro.build.version.release))"
sh_ settings put system font_scale 1.0
sh_ cmd uimode night no >/dev/null
sh_ svc power stayon true
# Wake the screen: the emulator sleeps between runs, and nothing on it can be read or tapped then.
a shell input keyevent KEYCODE_WAKEUP
sh_ wm dismiss-keyguard >/dev/null 2>&1
setup_quick_dump || echo "note: no JDK or Android SDK platform to build the quick screen reader; using uiautomator dump (slow on countdowns)" >&2
# Android's "Remove animations" (the app follows it), so nothing is read or tapped mid-movement.
# Put back as it was when the run ends. E2E_ANIMATIONS=1 keeps animations on.
ANIM_KEYS="window_animation_scale transition_animation_scale animator_duration_scale"
ANIM_BEFORE=$(for k in $ANIM_KEYS; do sh_ settings get global "$k"; done | tr '\n' ' ')
restore_animations() {
  local k
  set -- $ANIM_BEFORE
  for k in $ANIM_KEYS; do
    if [ "${1:-null}" = null ]; then sh_ settings delete global "$k" >/dev/null; else sh_ settings put global "$k" "$1"; fi
    shift
  done
}
if [ "${E2E_ANIMATIONS:-0}" != 1 ]; then
  trap restore_animations EXIT
  for k in $ANIM_KEYS; do sh_ settings put global "$k" 0; done
fi

# ---------- 1. First run ----------
sh_ pm clear $P >/dev/null
# Clearing data keeps the exact-alarm grant: put it back to a new install's default (off). Android
# keeps it per app and per user id, and the user-id setting (what the alarms page sets) wins.
sh_ appops set --uid $P SCHEDULE_EXACT_ALARM deny
sh_ appops set $P SCHEDULE_EXACT_ALARM default
open_app 25
# After clearing data the development build downloads its code again: that can take a while.
check "welcome: title" wait_for "Give your eyes regular breaks" 90
# Give the development build's menu intro time to appear, so dump() can close it.
sleep 5
dump
# The development build's floating Tools button sits over the Settings gear: switch it off.
# Only press Back if its menu really opened (on the welcome screen Back would close the app).
a shell input keyevent 82
if wait_for "Fast Refresh" 6; then
  a shell input swipe 540 1900 540 900 300
  sleep 1
  dump
  tools_y=$(center_of "Tools button" | cut -d' ' -f2)
  [ -n "$tools_y" ] && a shell input tap 960 "$tools_y"
  sleep 1
  back
  sleep 2
fi
wait_for "Give your eyes regular breaks" 10
check "welcome: duck says hello" on_screen "Hi! I'll remind you to rest your eyes."
check "welcome: explains the 20-20-20 rule" on_screen "The 20-20-20 rule"
tap "Allow reminders"
check "welcome: asks for notification permission" wait_for "send you notifications" 10
tap "Allow"
check "welcome: asks for on-time reminders" wait_for "Stay on time" 10
tap "Not now"
check "welcome: all set" wait_for "You're all set" 10
check "welcome: says when the first reminder comes" on_screen "First reminder"
tap "Start"
sleep 3
close_app
setstate "$QUIET_AWAY"
open_app
check "home: countdown" wait_for "Next break in" 10
check "home: warns that reminders may run late" on_screen "Reminders may run late"
check "home: duckling to start with" on_screen "Jenny, a duckling"
check "home: first goal is 5 breaks away" on_screen "Something new in 5 breaks"
check "home: no breaks yet" on_screen "No breaks yet today"
sleep 15
check "reminders booked ahead (100+)" ge "$(alarm_count)" 100
check "tray timer shown" tray_has "Next break"

# ---------- 2. On-time reminders ----------
tap "Allow"
check "allow opens Android's alarms page" wait_for "Alarms" 10
tap "Allow setting alarms and reminders"
sleep 1
on_screen "Alarms" && back
sleep 3
check "warning gone once allowed" not on_screen "Reminders may run late"
check "reminders booked as exact alarms" exact_alarms

# ---------- 3. Settings ----------
tap "Settings"
check "settings: opens" wait_for "20-20-20 rule" 10
tap "20-20-20 rule"
check "settings: custom timing appears with the rule off" wait_for "Remind me every" 5
check "settings: break length appears with the rule off" on_screen "Break length"
tap "20-20-20 rule"
sleep 1
check "settings: custom timing hidden with the rule on" not on_screen "Remind me every"
check "settings: quiet hours" on_screen "Pause reminders at night"
check "settings: quiet hours from" on_screen "From, "
check "settings: quiet hours until" on_screen "Until, "
check "settings: sound rows" on_screen "Break reminder"
a shell input swipe 540 1800 540 700 300
sleep 1
check "settings: vibration for button taps" on_screen "Button taps"
check "settings: tray timer switch" on_screen "Timer in notifications"
check "settings: notifications allowed" on_screen "Notifications: ✓ Allowed"
check "settings: on-time reminders allowed" on_screen "On-time reminders: ✓ Allowed"
check "settings: privacy line" on_screen "Everything stays on this phone"

# ---------- 4. Sound picker ----------
a shell input swipe 540 700 540 1800 300
sleep 1
tap "Break reminder"
check "sound picker: opens" wait_for "Reminder sound" 5
for s in Quack Chime Drop Bell Beep; do
  before=$(last_sound)
  tap "$s"
  sleep 1
  check "sound picker: $s plays" sound_started_since "$before"
  sleep 1
done
tap "Voice"
check "sound picker: voice choices" wait_for "Heart" 5
check "sound picker: voice says time to rest" on_screen "Time to rest"
tap "Phone sound"
check "sound picker: phone sound card" wait_for "Choose phone sound" 5
tap "Quack"
sleep 1
back
sleep 2
check "settings: shows the chosen sound" on_screen "Break reminder: Quack"
back
sleep 2

# ---------- 5. A break ----------
check "home: back from settings" wait_for "Take a break now" 5
tap "Take a break now"
check "break: look far away" wait_for "Look far away" 5
check "break: countdown in seconds" on_screen "seconds left"
check "break: skip offered" on_screen "Skip"
check "break: done after 20 s" wait_for "Break done" 30
check "break: counts today" on_screen "1 break today"
tap "Back to it"
check "home: one break today" wait_for "1 break today" 5
check "break counted toward the pond" eq "$(state_js d.pond.total)" 1
tap "Take a break now"
sleep 2
tap "Skip"
check "break: skipped" wait_for "Break skipped" 5
tap "Back"
check "home: skipped break not counted" wait_for "1 break today" 5
# Stop on the tray timer during a break ends the break early: the break screen closes rather than
# finishing as "Break done", and the break isn't counted.
tap "Take a break now"
sleep 2
expand_shade
xy=$(tray_action "Stop")
check "tray during a break: stop shown" test -n "$xy"
# shellcheck disable=SC2086
[ -n "$xy" ] && a shell input tap $xy
sleep 2
collapse_shade
check "tray during a break: stop closes the break screen" wait_for "Take a break now" 8
check "tray during a break: not counted" eq "$(state_js 'Object.values(d.days)[0]')" 1
tap "Take a break now"
sleep 23
check "break: a second break is done after 20 s too" on_screen "Break done"
tap "Back to it"
sleep 1
check "a second break within 5 minutes doesn't grow the pond" eq "$(state_js d.pond.total)" 1
check "but it does count for today" eq "$(state_js 'Object.values(d.days)[0]')" 2

# ---------- 6. Break time, snooze and skip on Home ----------
close_app
setstate 'd.settings.quiet.enabled=false; d.timer.anchor=Date.now()-25*60e3; d.timer.setAt=d.timer.anchor; d.timer.breakEndsAt=null'
open_app
check "home: break time" wait_for "Break time" 10
check "home: start break" on_screen "Start break"
tap "Snooze 5 min"
check "home: snooze reaction" glimpse "Okay. I'll remind you in 5 minutes." 3
check "home: next break in 5 min" wait_for "5 min" 5
check "snooze saved" eq "$(state_js 'd.timer.snoozed===true')" true
close_app
setstate 'd.timer.anchor=Date.now()-25*60e3; d.timer.setAt=d.timer.anchor; delete d.timer.snoozed'
open_app
tap "Skip"
check "home: duck shrugs after a skip" glimpse "shrugs" 3
check "home: next break in 20 min after skip" wait_for "20 min" 5

# ---------- 7. Quiet hours ----------
close_app
setstate 'const n=new Date();const m=n.getHours()*60+n.getMinutes();d.settings.quiet={enabled:true,startMin:(Math.floor(m/30)*30+1410)%1440,endMin:(Math.floor(m/30)*30+60)%1440}'
open_app
check "home: quiet hours" wait_for "Quiet hours" 10
check "home: take a break anyway" on_screen "Take a break anyway"
check "home: duck asleep" on_screen "is asleep"
close_app
setstate "$QUIET_AWAY"

# ---------- 8. Tray: stop and resume with the app closed ----------
# Quiet hours for the next few hours, so the timer shows "Next break at ..." (a ticking
# countdown keeps the shade from ever being idle, and uiautomator can't read it then).
setstate 'const n=new Date();const m=n.getHours()*60+n.getMinutes();d.settings.quiet={enabled:true,startMin:(Math.floor(m/30)*30+1410)%1440,endMin:(Math.floor(m/30)*30+240)%1440}'
open_app
close_app
expand_shade
shot tray-before-stop
xy=$(tray_action "Stop")
check "tray: stop button shown" test -n "$xy"
# shellcheck disable=SC2086
[ -n "$xy" ] && a shell input tap $xy
check "tray: stop cancels every reminder" alarms_cleared 20
check "tray: says reminders stopped" tray_has "Reminders stopped"
a shell am kill $P
xy=$(tray_action "Resume")
check "tray: resume button shown" test -n "$xy"
# shellcheck disable=SC2086
[ -n "$xy" ] && a shell input tap $xy
sleep 25
check "tray: resume rebooks reminders with the app closed" ge "$(alarm_count)" 100
check "tray: timer back after resume" tray_has "Next break"
collapse_shade

# ---------- 9. Test reminder: buttons with the app closed ----------
open_app
tap "Settings"
sleep 1
a shell input swipe 540 1800 540 600 300
sleep 1
tap "Send a test reminder"
check "test reminder: confirmation" wait_for "Sent." 3
close_app
sleep 12
check "test reminder: arrives with the app closed" tray_is "Test reminder"
expand_shade
dump
xy=$(center_of "Snooze 5 min")
# shellcheck disable=SC2086
[ -n "$xy" ] && a shell input tap $xy
sleep 20
check "test reminder: snooze works with the app closed" eq "$(state_js 'd.timer.snoozed===true')" true
collapse_shade

# ---------- 10. The pond ----------
setstate "$QUIET_AWAY"'; d.pond={total:95,lastAt:Date.now()-600000,name:"Jenny",wearing:"beanie",seen:60}'
open_app
check "home: young duck wearing a beanie" wait_for "Jenny, a young duck wearing a beanie" 10
check "home: new things to see" on_screen "Your pond. Something new"
tap "Your pond. Something new"
check "pond: opens" wait_for "Found so far" 5
check "pond: young duck" on_screen "Young duck"
check "pond: 95 breaks" on_screen "95 breaks so far"
check "pond: next stage" on_screen "Grown duck at 250 breaks"
check "pond: 8 of 13 found" on_screen "8 of 13"
check "pond: beanie worn" on_screen "Beanie. Wearing. Tap to take it off."
check "pond: bow can be worn" on_screen "Bow. Tap to wear it."
check "pond: snail locked" on_screen "Snail. Locked. Unlocks at 100 breaks."
check "pond: frog in the pond" on_screen "Frog friend. In your pond."
tap "Bow. Tap to wear it."
check "pond: wearing the bow" wait_for "Bow. Wearing. Tap to take it off." 3
check "pond: beanie off" on_screen "Beanie. Tap to wear it."
tap "Bow. Wearing. Tap to take it off."
check "pond: bow off again" wait_for "Bow. Tap to wear it." 3
check "pond: nothing worn" eq "$(state_js d.pond.wearing)" null
tap "Your duck's name"
sleep 1
a shell input keyevent KEYCODE_MOVE_END
# Clear the whole name, whatever its length (names are at most 20 characters).
for i in $(seq 24); do a shell input keyevent KEYCODE_DEL; done
type_slowly "Quackers"
a shell input keyevent 66
sleep 1
check "pond: renamed" eq "$(state_js d.pond.name)" '"Quackers"'
# A name typed and left with Back, without pressing Enter, is kept too.
tap "Your duck's name"
sleep 1
a shell input keyevent KEYCODE_MOVE_END
for i in $(seq 24); do a shell input keyevent KEYCODE_DEL; done
type_slowly "Waddles"
sleep 1
check "pond: back to Home" back_to_home
check "pond: name typed and left with Back is kept" eq "$(state_js d.pond.name)" '"Waddles"'
check "home: new mark cleared after visiting" not on_screen "Your pond. Something new"
check "home: uses the new name" on_screen "Waddles, a young duck"

# ---------- 11. Unlocks ----------
close_app
setstate 'd.pond={...d.pond,total:99,lastAt:Date.now()-600000,seen:99}; d.timer.breakEndsAt=null'
open_app
on_screen "Take a break now" && tap "Take a break now" || tap "Take a break anyway"
check "unlock: new item after the break" wait_for "New in your pond" 30
check "unlock: it's the snail" on_screen "Snail"
check "unlock: see your pond" on_screen "See your pond"
tap "Back to it"
sleep 1
close_app
setstate 'd.pond={...d.pond,total:249,lastAt:Date.now()-600000,seen:249}'
open_app
on_screen "Take a break now" && tap "Take a break now" || tap "Take a break anyway"
check "unlock: grew up" wait_for "Waddles grew up" 30
check "unlock: grown duck" on_screen "Grown duck"
tap "Back to it"
sleep 1

# ---------- 12. Warnings ----------
close_app
sh_ pm revoke $P android.permission.POST_NOTIFICATIONS
open_app 8
check "warning: notifications off" wait_for "Notifications are off" 10
tap "Turn on"
check "warning: asks again" wait_for "send you notifications" 10
tap "Allow"
sleep 3
check "warning: gone once allowed" not on_screen "Notifications are off"
start_channel=$(sh_ dumpsys notification | grep -oE "alerts2_start_[a-z_]+" | head -1)
a shell am start -a android.settings.CHANNEL_NOTIFICATION_SETTINGS --es android.provider.extra.APP_PACKAGE $P --es android.provider.extra.CHANNEL_ID "$start_channel" >/dev/null
sleep 2
tap "Show notifications"
back
sleep 1
back
open_app
check "warning: reminders channel off" wait_for "Break reminders are off" 10
tap "Turn on"
sleep 2
tap "Show notifications"
back
sleep 3
check "warning: gone once the channel is back on" not on_screen "Break reminders are off"

# ---------- 13. Damaged saved data ----------
close_app
# One argument, so the device's shell runs the redirect inside run-as (in the app's folder).
sh_ "run-as $P sh -c 'echo \"{not json\" > files/quack-state.json'"
check "setup: the main save file is damaged" eq "$(sh_ run-as $P cat files/quack-state.json)" '{not json'
open_app 8
check "recovers from a damaged save using the backup" wait_for "Next break in" 10
check "kept the duck's name from the backup" on_screen "Waddles"
close_app
sh_ "run-as $P sh -c 'echo \"{bad\" > files/quack-state.json; echo \"{bad\" > files/quack-state.bak'"
check "setup: both save files are damaged" eq "$(sh_ run-as $P cat files/quack-state.json files/quack-state.bak | tr '\n' ' ')" '{bad {bad '
open_app 10
check "starts fresh, without crashing, when both copies are damaged" wait_for "Give your eyes regular breaks" 15

# ---------- 14. Large text ----------
tap "Allow reminders" && sleep 2 && tap "Allow" && sleep 2
on_screen "Not now" && tap "Not now"
sleep 1
tap "Start"
sleep 3
# Out of quiet hours whatever the time of day, so Home shows the countdown.
close_app
setstate "$QUIET_AWAY"
sh_ settings put system font_scale 2.0
sleep 6
open_app 6
check "large text: countdown still shown" wait_for "Next break in" 10
check "large text: button still shown" on_screen "Take a break now"
shot large-text-home
sh_ settings put system font_scale 1.0
sleep 4

# ---------- Results ----------
sh_ svc power stayon false
echo
echo "$PASS passed, $FAIL failed (screenshots of failures in $OUT)"
for f in "${FAILED[@]}"; do echo "  failed: $f"; done
[ "$FAIL" -eq 0 ]
