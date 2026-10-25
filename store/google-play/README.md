# Quack Break on Google Play

Everything to paste into Google Play Console, plus the steps in order.
The pictures are in this folder too: `icon-512.png`, `feature-graphic.png` and `screenshots/`.

## Steps

1. **Make a Google Play developer account** at play.google.com/console. Pick "Personal". It costs US$25 once, and Google checks your ID, email and phone.
2. **Create the app** in Play Console: name "Quack Break", language English, type App, Free.
3. **Set the version.** In `app.json`, change `"version": "0.1.0"` to `"1.0.0"`.
4. **Build the store file:** `npx eas-cli@latest build --platform android --profile production`. This makes an `.aab` file. Download it from the build page when it finishes.
5. **Upload it to a closed test.** In Play Console, open Closed testing, create a release and drag in the `.aab`. Google reviews this first release, which can take a few days.
6. **Fill in the store listing and the App content forms** using the text below.
7. **Get 12 testers for 14 days.** New personal accounts must do this before going public. Add their Gmail addresses to the closed test, send them the opt-in link, and ask them to install the app and keep it for the full 14 days.
8. **Apply for production** from the Dashboard. Google asks how testing went. Review usually takes up to 7 days.
9. **Release.** Send the same build to Production. Start with a small rollout, for example 20%, then raise it.

The package name `com.chesd.quackbreak` can never change after the first upload.

---

## Store listing

### App name (30 characters max)

```
Quack Break: 20-20-20 Eye Rest
```

### Short description (80 characters max)

```
A friendly duck that reminds you to rest your eyes with the 20-20-20 rule
```

### Full description (4000 characters max)

```
Quack Break is a small, friendly app that reminds you to rest your eyes when you spend a long time looking at a screen.

It is handy for long days at a computer, studying, gaming, or reading on your phone.

It follows the 20-20-20 rule: every 20 minutes, look at something about 20 feet (6 meters) away for 20 seconds. Jenny the duck keeps time and gives you a gentle quack when it's break time.

How it works
• Jenny reminds you every 20 minutes.
• Tap Start break and look at something far away.
• A ring counts down your 20 seconds.
• That's it. Back to what you were doing.

Your pond grows with every break
Each break you take helps Jenny grow from a duckling into a pond legend. Along the way you'll find lily pads, a frog friend, a paper boat, a goldfish and more, plus a beanie, a bow, a scarf and blue-light glasses for your duck to wear. You can give your duck a new name too.

Make it yours
• Choose how often to be reminded, from every 5 to every 90 minutes.
• Choose how long a break lasts, from 10 seconds to 2 minutes.
• Snooze for 5, 10 or 15 minutes, or skip a break.
• Quiet hours pause reminders at night.
• Pick a sound: a quack, a spoken voice, a chime, a bell and more, any sound on your phone, or silence.
• Turn vibration on or off.
• See a countdown to your next break in your notifications.
• A calm night look that follows your phone's dark theme.
• Works with your phone's text size and reduce motion settings.

Private by design
• No account and no sign-up.
• No ads.
• No tracking. Your breaks and settings stay on your phone.
• Works without an internet connection.

Quack Break is a reminder app. It is not a medical device and does not diagnose, treat or prevent any condition. If your eyes often feel sore or tired, talk to an eye doctor.
```

### Pictures

| Field | File |
| --- | --- |
| App icon | `icon-512.png` |
| Feature graphic | `feature-graphic.png` |
| Phone screenshots, in this order | `screenshots/01-reminder.png` to `07-settings.png` |

The screenshots are the real app with a short headline on top. The first three matter most: many people only see those before deciding. They meet Google's rules for recommendation spots: 1080 x 1920, at least four, headline text well under a fifth of each picture, and no phone frames.

| Screenshot | Headline | Alt text, if asked |
| --- | --- | --- |
| `01-reminder.png` | A friendly reminder to rest your eyes | Home screen with a duck by a pond and the time until the next break |
| `02-look-away.png` | Look far away for 20 seconds | A break in progress with a ring counting down the seconds |
| `03-grow.png` | Every break helps your duck grow | Break done, with a new bow unlocked for the duck |
| `04-pond.png` | Find frogs, boats, bows and more | The pond collection showing items found so far |
| `05-notification.png` | Your next break, right in your notifications | A notification counting down to the next break |
| `06-night.png` | A calm look for late nights | Home at night when a break is due, with Start, Snooze and Skip |
| `07-settings.png` | Set your own timing and sounds | Settings for the 20-20-20 rule, snooze, quiet hours and sounds |

### Release notes for the first version (500 characters max)

```
Hello from Jenny! Quack Break reminds you to rest your eyes with the 20-20-20 rule. Take a break, look far away, and watch your pond grow.
```

### Category and contact

- **App category:** Health & Fitness
- **Tags:** pick up to five that fit, such as health and wellness or productivity
- **Email:** an address you're happy to show in public
- **Privacy policy:** the web address where you put `privacy-policy.md`

---

## App content forms

In Play Console, find the App content page under Policy.

| Form | Answer |
| --- | --- |
| Privacy policy | The public web address of `privacy-policy.md` |
| Ads | No, my app does not contain ads |
| App access | All functionality is available without special access |
| Content rating | Category "All other app types". Answer No to every question. Expect Everyone / PEGI 3. |
| Target audience | Ages 13 to 15, 16 to 17, and 18 and over. Leave out under 13, which brings in Google's extra rules for children's apps. |
| Data safety | "Does your app collect or share any of the required user data types?" No. |
| Advertising ID | No, the app does not use advertising ID |
| Government apps | No |
| Financial features | None |
| Health apps | Tick "Stress Management, Relaxation, Mental Acuity". It is the closest fit for a rest-break reminder. If you'd rather not, "My app doesn't provide any health features" is the other option. |

Exact alarms need no form. The app uses the version of that permission that the user switches on in "Alarms & reminders". Google only asks for a form for the other version, which apps get automatically.

---

## Getting noticed

Google chooses which apps to feature. You can nominate yours with its featuring form at support.google.com/googleplay/contact/featuring_review. For a new app, send it at least four weeks before the launch date you want, after the build is uploaded to Play Console. It doesn't guarantee anything.

What Google looks at, and where this app stands:

- **A complete, sharp listing.** Done: icon, feature graphic, seven 1080 x 1920 screenshots, a clear short description.
- **Few crashes and freezes.** Google shows these under Android vitals in Play Console. The app passed 5,000 random taps with no crash, so watch that page after launch.
- **Ratings and reviews.** Ask your 12 testers to leave honest reviews once the app is public. Reply to reviews in Play Console.
- **Up-to-date Android.** Done: the app targets Android 16.
- **Search.** People find apps by words in the name and descriptions. The listing uses the words people search for: eye break, rest your eyes, 20-20-20 rule, screen, reminder.
