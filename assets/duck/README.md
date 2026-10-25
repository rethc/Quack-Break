# Duck pictures

The app animates the duck like a flip book. Each picture in this folder is the whole duck in one pose (a **frame**), and the app shows one frame at a time. All frames are see-through PNGs on the same 600 x 600 square, with the duck standing on the same spot, so switching between them makes the duck move.

[guide/frames.png](guide/frames.png) shows every frame with its name and when the app uses it.

## Where the duck comes from

The frames are cut from four AI sprite sheets in [source/](source/). Each sheet is one row of six ducks on a light blue background, each standing on a blue shadow:

| Sheet | Ducks used |
| --- | --- |
| `sprites-walk.jpg` | Standing (1st), and the walk cycle (3rd to 6th). The 2nd, a lunge, is left out because it jumps out of the loop. |
| `sprites-wave.jpg` | Waving (2nd), wings up (3rd), happy (4th) and quacking (6th) |
| `sprites-sit.jpg` | Sitting (2nd), sleepy (3rd), resting with happy closed eyes (4th), dozing with a Zz (5th) and asleep (6th) |
| `sprites-glasses.jpg` | The blue-light glasses, taken from the 1st duck |
| `logo.jpg` | The app icon: the duck in blue-light glasses. Its rounded tile is dropped and the blue gradient rebuilt full bleed, because phones and the store cut their own shape. |

`npm run duck:from-sheet` remakes every picture from these. It lifts each duck off its background, lines all the frames up on their shadows, draws the blink and the Zzz, works out where the head is in every frame, places the things to wear, and makes the app icons and the opening-screen picture from the logo. It saves the frames with 256 colours, which keeps them small and looks the same.

`character-sheet.png` and `accessories-sheet.png` are the earlier AI pictures. The beanie, bow and scarf still come from the accessories sheet.

## Swapping in new art

- **A better sheet with the same layout** (one row of six ducks on a plain background, each on a shadow): replace the file in `source/` and run `npm run duck:from-sheet`. The ducks are found and lined up automatically.
- **A different order of poses**: the list at the top of `scripts/duck-from-sheet/sprites.cjs` says which duck becomes which frame.
- **Where a hat, bow or scarf sits**: the numbers at the top of `scripts/duck-from-sheet/accessories.cjs`.
- **Check it**: `npm run duck:check` says in plain words if a picture is missing, the wrong size or not see-through.
- **See it**: phones need a new build to show new pictures.

## The frames

| File | When it shows |
| --- | --- |
| `stand.png` | Most of the time |
| `blink.png` | Blinking, every few seconds |
| `walk-1.png` to `walk-4.png` | Walking in when a screen opens. The steps follow the distance, so they slow down as the duck does. |
| `talk.png` | A little quack now and then, and while waving |
| `wave.png` | Waving and hopping when a break is due |
| `cheer.png`, `happy.png` | Wings up, then a happy face, when a break is done |
| `sit.png` | Sitting down |
| `sleepy.png` | Getting sleepy at the start of quiet hours |
| `content.png` | Resting its eyes during a break |
| `asleep.png`, `dozing.png` | Asleep during quiet hours, with a Zz now and then |

## Things to wear

| File | What it is |
| --- | --- |
| `beanie.png`, `bow.png`, `scarf.png`, `glasses.png` | Placed on the standing duck. In other frames the app moves them with the head (the numbers are in `src/components/duck/layout.ts`, made by the script). |
| `icon-beanie.png`, `icon-bow.png`, `icon-scarf.png`, `icon-glasses.png` | The same things on their own, for the pond screen and the unlock card |

## Other duck pictures

These aren't part of the animated duck. `npm run duck:from-sheet` makes them from `source/logo.jpg`. Replacing them needs a new build.

| File | What it is | Size |
| --- | --- | --- |
| `../icon.png` | App icon, also used on the store | 1024 x 1024 |
| `../android-icon-foreground.png` | Android app icon: the duck, see-through around it, inside the middle circle no launcher cuts | 1024 x 1024 |
| `../android-icon-background.png` | Android app icon: the blue gradient behind the duck | 1024 x 1024 |
| `../android-icon-monochrome.png` | One-colour icon for Android's themed icons | 1024 x 1024 |
| `../splash-icon.png` | Picture on the opening screen, while the app loads | 512 x 512 |
| `../notification-icon.png` | Small icon in the status bar. A plain white shape on see-through | 96 x 96 |
| `../../store/google-play/icon-512.png` | Store icon: the app icon, halved | 512 x 512 |
