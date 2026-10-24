// The app's words: every duck line and notification, line picking, and the sound each moment plays.
// Run with: npm test   (Node's built-in test runner, no extra packages)
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import * as messages from './messages.ts';
import { hash, pick, pickFresh, reminderBodies, snoozeLine } from './messages.ts';
import { OUT_BODY, OUT_TITLE } from './notificationPlan.ts';
import {
  ANDROID_ONLY_SOUNDS,
  soundFile,
  soundLabel,
  soundOf,
  SOUND_OPTIONS,
  VOICE_OPTIONS,
  vibrateOf,
  type Moment,
} from './sounds.ts';
import { BREAK_CHOICES, DEFAULT_SETTINGS, settingsFrom, SNOOZE_CHOICES } from './types.ts';
import type { Settings, SoundId, VoiceId } from './types.ts';

/** The speech bubble fits this many characters (on one or two lines). */
const MAX_LINE = 50;
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|️/u;

const chars = (s: string) => Array.from(s).length;

/** A full sentence the duck says, or a notification body. */
function checkLine(line: unknown) {
  assert.equal(typeof line, 'string');
  const s = line as string;
  assert.ok(chars(s) <= MAX_LINE, `${chars(s)} characters, more than ${MAX_LINE}: ${JSON.stringify(s)}`);
  assert.match(s, /^\p{Lu}/u, `should start with a capital letter: ${JSON.stringify(s)}`);
  assert.match(s, /[.!?]$/, `should end with . ! or ?: ${JSON.stringify(s)}`);
  assert.doesNotMatch(s, EMOJI, `should have no emoji: ${JSON.stringify(s)}`);
  assert.doesNotMatch(s, / {2}/, `should have no double spaces: ${JSON.stringify(s)}`);
  assert.equal(s, s.trim(), `should have no leading or trailing space: ${JSON.stringify(s)}`);
  assert.doesNotMatch(s, /[\t\r\n]/, `should be one line of text: ${JSON.stringify(s)}`);
}

/** A notification title: a short label, so no rule about ending punctuation. */
function checkTitle(title: unknown) {
  assert.equal(typeof title, 'string');
  const s = title as string;
  assert.ok(s.length > 0 && chars(s) <= MAX_LINE, JSON.stringify(s));
  assert.match(s, /^\p{Lu}/u, `should start with a capital letter: ${JSON.stringify(s)}`);
  assert.doesNotMatch(s, EMOJI, `should have no emoji: ${JSON.stringify(s)}`);
  assert.doesNotMatch(s, / {2}/, `should have no double spaces: ${JSON.stringify(s)}`);
  assert.equal(s, s.trim(), JSON.stringify(s));
  assert.doesNotMatch(s, /[\t\r\n]/, JSON.stringify(s));
}

/** Every exported list of lines in messages.ts, found by looking, so new lists get checked too. */
const LISTS = Object.entries(messages).filter((e): e is [string, readonly string[]] => Array.isArray(e[1]));
const TITLE_LISTS = LISTS.filter(([name]) => name.endsWith('Titles'));
const LINE_LISTS = LISTS.filter(([name]) => !name.endsWith('Titles'));

/** Deterministic Math.random for the tests (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withRandom<T>(seed: number, fn: () => T): T {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

/** FNV-1a 32-bit over UTF-8 bytes, written independently with BigInt (the spec's definition). */
function fnv1aReference(s: string): number {
  let h = 0x811c9dc5n;
  for (const byte of new TextEncoder().encode(s)) {
    h ^= BigInt(byte);
    h = (h * 0x01000193n) & 0xffffffffn;
  }
  return Number(h);
}

describe('what the duck says', () => {
  it('finds the lists to check', () => {
    const names = LINE_LISTS.map(([name]) => name);
    for (const expected of [
      'breakLines',
      'doneLines',
      'skipLines',
      'waitingLines',
      'dueLines',
      'pausedLines',
      'quietLines',
      'breakRunningLines',
      'breakOverBodies',
    ]) {
      assert.ok(names.includes(expected), expected);
    }
  });

  for (const [name, list] of LINE_LISTS) {
    list.forEach((line, i) => {
      it(`${name}[${i}] fits the bubble and follows the copy rules: ${JSON.stringify(line)}`, () => checkLine(line));
    });
  }

  it('never has an empty list (the screen would show nothing)', () => {
    for (const [name, list] of LISTS) assert.ok(list.length > 0, name);
  });

  it('never repeats a line within a list', () => {
    for (const [name, list] of LISTS) {
      const dupes = list.filter((line, i) => list.indexOf(line) !== i);
      assert.deepEqual(dupes, [], name);
    }
  });
});

describe('notification text', () => {
  for (const [name, list] of TITLE_LISTS) {
    list.forEach((title, i) => {
      it(`${name}[${i}] is a short plain title: ${JSON.stringify(title)}`, () => checkTitle(title));
    });
  }

  it('says how long to look away, for every break length', () => {
    for (const sec of [...BREAK_CHOICES, 20, 45]) {
      const bodies = reminderBodies(sec);
      assert.ok(bodies.length > 0, `${sec}`);
      for (const body of bodies) {
        checkLine(body);
        assert.match(body, new RegExp(`\\b${sec} seconds\\b`), body);
      }
    }
  });

  it('gives a fresh list each time, so callers cannot change it for everyone', () => {
    const a = reminderBodies(20);
    assert.notEqual(a, reminderBodies(20));
    assert.deepEqual(a, reminderBodies(20));
  });

  for (const min of [...new Set([5, 10, 15, ...SNOOZE_CHOICES])]) {
    it(`confirms a ${min}-minute snooze`, () => {
      const line = snoozeLine(min);
      checkLine(line);
      assert.match(line, new RegExp(`\\b${min} minutes\\b`));
    });
  }

  it('words the last-call notification the same way', () => {
    checkTitle(OUT_TITLE);
    checkLine(OUT_BODY);
  });
});

describe('pick', () => {
  const lines = ['one', 'two', 'three', 'four', 'five'];

  it('gives the same line for the same seed, every time', () => {
    const at = new Date(2026, 9, 22, 10, 20).getTime();
    for (const seed of [0, 1, 42, at, at + 1, 'x', '']) {
      const first = pick(lines, seed);
      for (let k = 0; k < 5; k++) assert.equal(pick(lines, seed), first, String(seed));
    }
  });

  it('treats a number and its text the same', () => {
    for (const n of [0, 7, 123456789, 1792648800000]) assert.equal(pick(lines, n), pick(lines, String(n)));
  });

  it('follows the hash, so known seeds give known lines', () => {
    assert.equal(pick(['a', 'b', 'c'], ''), 'b'); // 2166136261 % 3 === 1
    assert.equal(pick(['x', 'y'], 'a'), 'x'); // 3826002220 % 2 === 0
    for (let seed = 0; seed < 50; seed++) assert.equal(pick(lines, seed), lines[hash(String(seed)) % lines.length]);
  });

  it('always gives a line from the list, and uses every line across reminder times', () => {
    const start = new Date(2026, 9, 22, 9, 0).getTime();
    const seen = new Set<string>();
    for (let k = 0; k < 200; k++) {
      const line = pick(lines, start + k * 20 * 60_000);
      assert.ok(lines.includes(line));
      seen.add(line);
    }
    assert.equal(seen.size, lines.length);
    for (const odd of [-1, -123.5, 0.1, Number.MAX_SAFE_INTEGER]) assert.ok(lines.includes(pick(lines, odd)), String(odd));
  });

  it('gives the only line of a one-line list', () => {
    assert.equal(pick(['only'], 12345), 'only');
  });
});

describe('pickFresh', () => {
  it('never repeats the line to avoid, over 200 picks, for every list', () => {
    withRandom(20_20_20, () => {
      for (const [name, list] of LISTS) {
        if (list.length < 2) continue;
        for (const avoid of list) {
          for (let k = 0; k < 200; k++) {
            const line = pickFresh(list, avoid);
            assert.notEqual(line, avoid, `${name}: repeated ${JSON.stringify(avoid)}`);
            assert.ok(list.includes(line), name);
          }
        }
      }
    });
  });

  it('still reaches every other line while avoiding one', () => {
    const lines = ['a', 'b', 'c', 'd', 'e'];
    const seen = withRandom(7, () => {
      const s = new Set<string>();
      for (let k = 0; k < 200; k++) s.add(pickFresh(lines, 'c'));
      return s;
    });
    assert.deepEqual([...seen].sort(), ['a', 'b', 'd', 'e']);
  });

  it('can pick any line when there is nothing to avoid', () => {
    const lines = ['a', 'b', 'c', 'd'];
    const seen = withRandom(99, () => {
      const s = new Set<string>();
      for (let k = 0; k < 200; k++) {
        s.add(pickFresh(lines));
        s.add(pickFresh(lines, 'not in the list'));
      }
      return s;
    });
    assert.deepEqual([...seen].sort(), lines);
  });

  it('always gives the other line of a two-line list', () => {
    withRandom(1, () => {
      for (let k = 0; k < 200; k++) {
        assert.equal(pickFresh(['left', 'right'], 'left'), 'right');
        assert.equal(pickFresh(['left', 'right'], 'right'), 'left');
      }
    });
  });

  it('gives the only line of a one-line list, even if it is the one to avoid', () => {
    assert.equal(pickFresh(['only'], 'only'), 'only');
    assert.equal(pickFresh(['only']), 'only');
  });

  it('leaves Math.random as it was after the seeded runs', () => {
    const original = Math.random;
    assert.throws(() =>
      withRandom(3, () => {
        throw new Error('boom');
      }),
    );
    assert.equal(Math.random, original);
    // The seeded generator is deterministic and stays in [0, 1).
    const a = withRandom(5, () => Array.from({ length: 1000 }, () => Math.random()));
    const b = withRandom(5, () => Array.from({ length: 1000 }, () => Math.random()));
    assert.deepEqual(a, b);
    assert.ok(a.every((r) => r >= 0 && r < 1));
  });
});

describe('hash (FNV-1a, 32-bit)', () => {
  it('matches the known values for "" and "a"', () => {
    // Checked against the BigInt reference below before relying on them.
    assert.equal(fnv1aReference(''), 2166136261);
    assert.equal(fnv1aReference('a'), 3826002220);
    assert.equal(hash(''), 2166136261);
    assert.equal(hash('a'), 3826002220);
  });

  it('matches the published test vector for "foobar"', () => {
    assert.equal(hash('foobar'), 0xbf9cf968);
  });

  it('matches an independent implementation for text the app hashes', () => {
    const inputs = ['5|quack|true|quack|true|heart|20|5', '1792648800000', '1792648800001', 'Break time', 'x'.repeat(1000)];
    withRandom(42, () => {
      for (let k = 0; k < 200; k++) {
        const len = Math.floor(Math.random() * 40);
        inputs.push(Array.from({ length: len }, () => String.fromCharCode(32 + Math.floor(Math.random() * 95))).join(''));
      }
    });
    for (const s of inputs) assert.equal(hash(s), fnv1aReference(s), JSON.stringify(s));
  });

  it('always gives an unsigned 32-bit whole number', () => {
    for (const s of ['', 'a', 'Zoë', '🦆', 'x'.repeat(10_000), '\u0000', '￿']) {
      const h = hash(s);
      assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, `${JSON.stringify(s)} -> ${h}`);
    }
  });

  it('is stable and tells similar text apart', () => {
    assert.equal(hash('Break over'), hash('Break over'));
    assert.notEqual(hash('a'), hash('b'));
    assert.notEqual(hash('1792648800000'), hash('1792648800001'));
    assert.notEqual(hash('ab'), hash('ba'));
  });
});

describe('sounds', () => {
  const SOUNDS: SoundId[] = ['quack', 'voice', 'chime', 'drop', 'bell', 'beep', 'phone', 'none'];
  const VOICES: VoiceId[] = ['heart', 'bella', 'michael', 'george'];
  const MOMENTS: Moment[] = ['start', 'end'];
  const settings = (sound: SoundId, voice: VoiceId): Settings => ({ ...DEFAULT_SETTINGS, startSound: sound, endSound: sound, voice });

  /** What each choice should play, by hand. */
  const expected = (sound: SoundId, m: Moment, voice: VoiceId): string | null => {
    if (sound === 'none') return null;
    if (sound === 'phone') return 'default';
    if (sound === 'voice') return `voice_${voice}_${m === 'start' ? 'rest' : 'work'}.wav`;
    return `${sound}.wav`;
  };

  /** Every bundled file soundFile can ask for. */
  const allFiles = () => {
    const files = new Set<string>();
    for (const start of SOUNDS) {
      for (const end of SOUNDS) {
        for (const voice of VOICES) {
          const s: Settings = { ...DEFAULT_SETTINGS, startSound: start, endSound: end, voice };
          for (const m of MOMENTS) {
            const f = soundFile(m, s);
            if (f !== null && f !== 'default') files.add(f);
          }
        }
      }
    }
    return [...files].sort();
  };

  const root = new URL('../../', import.meta.url);
  const soundsDir = new URL('assets/sounds/', root);

  for (const sound of SOUNDS) {
    it(`plays the right thing for "${sound}" at both moments, with every voice`, () => {
      for (const voice of VOICES) {
        for (const m of MOMENTS) {
          assert.equal(soundFile(m, settings(sound, voice)), expected(sound, m, voice), `${sound} ${m} ${voice}`);
        }
      }
    });
  }

  it('has the voice say "rest" when a break starts and "work" when it ends', () => {
    for (const voice of VOICES) {
      assert.match(soundFile('start', settings('voice', voice)) ?? '', /_rest\.wav$/);
      assert.match(soundFile('end', settings('voice', voice)) ?? '', /_work\.wav$/);
    }
  });

  it('gives each moment its own sound', () => {
    for (const start of SOUNDS) {
      for (const end of SOUNDS) {
        const s: Settings = { ...DEFAULT_SETTINGS, startSound: start, endSound: end, voice: 'bella' };
        assert.equal(soundFile('start', s), expected(start, 'start', 'bella'), `${start}/${end}`);
        assert.equal(soundFile('end', s), expected(end, 'end', 'bella'), `${start}/${end}`);
        assert.equal(soundOf('start', s), start);
        assert.equal(soundOf('end', s), end);
      }
    }
  });

  it('vibrates per moment', () => {
    const s: Settings = { ...DEFAULT_SETTINGS, startVibrate: true, endVibrate: false };
    assert.equal(vibrateOf('start', s), true);
    assert.equal(vibrateOf('end', s), false);
    assert.equal(vibrateOf('start', { ...s, startVibrate: false }), false);
  });

  it('offers every sound once, each one a valid saved setting, with plain labels', () => {
    assert.deepEqual(
      SOUND_OPTIONS.map((o) => o.value),
      SOUNDS,
    );
    for (const o of SOUND_OPTIONS) {
      assert.equal(settingsFrom({ startSound: o.value }).startSound, o.value);
      checkTitle(o.label);
    }
    assert.equal(settingsFrom({ startSound: 'trumpet' }).startSound, DEFAULT_SETTINGS.startSound);
  });

  it('offers every voice once, each one a valid saved setting, with plain labels', () => {
    assert.deepEqual(
      VOICE_OPTIONS.map((o) => o.value),
      VOICES,
    );
    for (const o of VOICE_OPTIONS) {
      assert.equal(settingsFrom({ voice: o.value }).voice, o.value);
      checkTitle(o.label);
    }
  });

  it('labels the Settings row with the sound, and the voice for "voice"', () => {
    const s: Settings = { ...DEFAULT_SETTINGS, startSound: 'voice', endSound: 'phone', voice: 'bella' };
    assert.equal(soundLabel('start', s), 'Voice · Bella');
    assert.equal(soundLabel('end', s), 'Phone sound');
    assert.equal(soundLabel('start', { ...s, startSound: 'quack' }), 'Quack');
    assert.equal(soundLabel('end', { ...s, endSound: 'none' }), 'None');
    for (const voice of VOICES) assert.match(soundLabel('start', { ...s, voice }), /^Voice · \p{Lu}\p{Ll}+$/u);
  });

  it('keeps Android-only sounds to the phone tone, which needs no bundled file', () => {
    assert.deepEqual([...ANDROID_ONLY_SOUNDS], ['phone']);
    for (const id of ANDROID_ONLY_SOUNDS) {
      assert.ok(SOUNDS.includes(id));
      assert.equal(soundFile('start', settings(id, 'heart')), 'default');
    }
  });

  it('has every sound file it can play in assets/sounds', () => {
    const files = allFiles();
    assert.equal(files.length, 5 + VOICES.length * 2);
    const onDisk = new Set(readdirSync(soundsDir));
    const missing = files.filter((f) => !onDisk.has(f));
    assert.deepEqual(missing, []);
  });

  it('lists every sound file it can play in app.json, for expo-notifications', () => {
    const app = JSON.parse(readFileSync(new URL('app.json', root), 'utf8')) as { expo: { plugins: unknown[] } };
    const plugin = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications') as
      | [string, { sounds?: string[] }]
      | undefined;
    assert.ok(plugin, 'expo-notifications plugin with options in app.json');
    const sounds = plugin[1].sounds ?? [];
    for (const p of sounds) assert.match(p, /^\.\/assets\/sounds\/[^/]+$/, p);
    const listed = new Set(sounds.map((p) => p.slice(p.lastIndexOf('/') + 1)));
    const missing = allFiles().filter((f) => !listed.has(f));
    assert.deepEqual(missing, []);
    // And nothing listed is missing on disk, or the native build fails.
    for (const p of sounds) assert.ok(existsSync(new URL(p, root)), p);
  });

  it('names sound files the way Android needs (lowercase letters, digits and _ only)', () => {
    for (const f of allFiles()) assert.match(f, /^[a-z][a-z0-9_]*\.wav$/, f);
  });
});
