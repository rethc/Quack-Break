# Quack Break 🦆

A tiny eye-break timer with a duck. Every 20 minutes it reminds you to look at something about 20 feet (6 m) away for 20 seconds (the 20-20-20 rule). No account, no backend, no tracking, no ads. Everything stays on the phone.

**Status:** MVP (timer, notifications with Start break / Snooze, break screen, animated duck, settings, light/dark mode).
**Next:** pond and streaks → iOS Live Activity / Android Live Update → home screen widgets.

## Run it on your phone (development build)

You need: Node 22.13+ / 24.3+ / 26+, a free [Expo account](https://expo.dev/signup), and for iPhone a paid Apple Developer account. Builds run in the cloud with EAS, so no Xcode or Android Studio is needed.

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest init          # links this folder to an Expo project (adds an id to app.json)
```

**Android**

```bash
npm run build:dev:android        # about 10–20 min in the cloud
```

Open the link or QR code from the build page on your phone and install the APK (allow "Install unknown apps" for your browser when asked).

**iPhone**

```bash
npx eas-cli@latest device:create # register your iPhone (open the link on the phone)
npm run build:dev:ios            # sign in to Apple when asked; EAS creates the certificates
```

On the iPhone, turn on Settings → Privacy & Security → **Developer Mode** (it restarts), then install from the build page link.

**Start the dev server**

```bash
npx expo start                   # phone and PC on the same Wi-Fi
npx expo start --tunnel          # if same Wi-Fi doesn't work
```

Open Quack Break on the phone. It lists the running server; tap it (or scan the QR code in the terminal). Code changes now reload instantly. You only need a new build when native settings change (`app.json` plugins or new native libraries).

## Test checklist (MVP)

1. **First launch:** the duck waddles in. Tap *Allow reminders*. On Android 12+, also allow *Alarms & reminders* so reminders stay on time while the phone is idle.
2. **Notifications:** Settings → *Send a test reminder*, then lock the phone. Within ~10 s you should hear the quack and see *Start break* and *Snooze* buttons.
   - *Snooze* should not open the app; Home then shows the next break in 5 min.
   - *Start break* opens the app on the break screen.
3. **Break:** start one, then lock the phone mid-break. A "Quack quack!" notification arrives when it ends. Open the app: the duck flaps and today's count goes up.
4. **Real schedule:** set Work time to 5 min, close the app (swipe it away) and wait. Reminders keep coming because they are booked in advance.
5. **Quiet hours:** set them to cover the current time. No reminders; Home shows a sleeping duck.
6. **Accessibility:** turn on Reduce Motion (the duck changes pose without moving), the largest text size (everything still fits and scrolls), and VoiceOver/TalkBack (duck, timer, steppers and switches are all labeled).
7. **Dark mode:** night pond with a moon and fireflies.

Known limit: on iOS, if the app was fully closed (swiped away), *Snooze* may not take effect, because iOS doesn't always let the app run code for it. The next regular reminder still arrives. If this happens on your phone, a small native fix is planned.

## How the timer works

Nothing ticks in the background. The app books up to 60 local notifications ahead (iOS allows 64 pending), skipping quiet hours, and rebuilds that list whenever the app opens, settings change, or a break starts, ends, is skipped or snoozed. Starting a break also books a "break over" notification, so the quack plays even if the screen locks. In the app, the same notification only plays its sound (no banner), so no audio library is needed.

## Project layout

```
src/app/            screens (Expo Router): _layout, index (Home), break, settings, welcome
src/core/           pure timer logic + tests (no React Native)
src/services/       storage (one JSON file), notifications, background Snooze (Android), haptics
src/components/     duck (SVG + Reanimated), pond scene, countdown ring, buttons, settings rows
src/theme/          day/night colors (contrast-checked), fonts
assets/             icons, Fredoka font (OFL), quack.wav, source SVGs
scripts/            make-quack.mjs: regenerates the quack sound
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | Dev server |
| `npm test` | Timer logic tests (Node's built-in runner) |
| `npm run typecheck` | TypeScript |
| `npm run lint` | ESLint |
| `npm run quack` | Rebuild `assets/sounds/quack.wav` |
| `npm run build:dev:android` / `build:dev:ios` | Development builds on EAS |

## Size notes

Kept small on purpose: no audio, image, Lottie or Rive libraries; the duck is SVG; storage is a JSON file via `expo-file-system` (already part of Expo). Android release builds use R8 and resource shrinking. `expo-notifications` includes Firebase on Android even for local-only use; that's unavoidable with this library.
