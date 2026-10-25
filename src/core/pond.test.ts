// The duck pet: growth stages, items, counting breaks and loading saved ponds.
// Run with: npm test   (Node's built-in test runner, no extra packages)
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  cleanName,
  countBreak,
  DEFAULT_DUCK_NAME,
  defaultPond,
  describeDuck,
  hasNew,
  isUnlocked,
  itemById,
  ITEMS,
  markSeen,
  MAX_NAME_LENGTH,
  MIN_GAP_MS,
  nextGoal,
  nextItem,
  nextStage,
  pondFrom,
  rename,
  stageFor,
  STAGES,
  unlockedItems,
  unlocksBetween,
  wear,
  type ItemId,
  type PondState,
} from './pond.ts';
import { HOUR, MINUTE } from './schedule.ts';
import { WORK_CHOICES } from './types.ts';

const SEC = 1000;
const T0 = new Date(2026, 9, 22, 10, 0).getTime();
const pond = (over: Partial<PondState> = {}): PondState => ({ ...defaultPond(), ...over });
const ids = (items: readonly { id: string }[]) => items.map((i) => i.id);

/** The spec, written out by hand, so the tests check the design and not the code against itself. */
const EXPECTED_STAGES: [string, string, number][] = [
  ['duckling', 'Duckling', 0],
  ['fluffy', 'Fluffy duckling', 15],
  ['young', 'Young duck', 75],
  ['grown', 'Grown duck', 250],
  ['legend', 'Pond legend', 750],
];

const EXPECTED_ITEMS: [ItemId, number, 'pond' | 'wear'][] = [
  ['lilypad', 5, 'pond'],
  ['waterlily', 20, 'pond'],
  ['frog', 30, 'pond'],
  ['beanie', 40, 'wear'],
  ['cattails', 50, 'pond'],
  ['dragonfly', 60, 'pond'],
  ['boat', 70, 'pond'],
  ['bow', 90, 'wear'],
  ['snail', 100, 'pond'],
  ['stones', 125, 'pond'],
  ['goldfish', 150, 'pond'],
  ['scarf', 180, 'wear'],
];

/** Every break count where something unlocks (plus 0), in order. */
const MARKS = [...new Set([0, ...EXPECTED_ITEMS.map((i) => i[1]), ...EXPECTED_STAGES.map((s) => s[2])])].sort(
  (a, b) => a - b,
);

describe('growth stages', () => {
  it('has stages at 0, 15, 75, 250 and 750 breaks', () => {
    assert.deepEqual(
      STAGES.map((s) => [s.id, s.name, s.from]),
      EXPECTED_STAGES,
    );
  });

  EXPECTED_STAGES.forEach(([id, name, from], i) => {
    it(`becomes "${name}" at exactly ${from} breaks, and not one break before`, () => {
      assert.equal(stageFor(from).id, id);
      const prev = EXPECTED_STAGES[i - 1];
      if (prev) {
        assert.equal(stageFor(from - 1).id, prev[0]);
        assert.equal(nextStage(from - 1)?.id, id);
      } else {
        // Nothing below the first stage: even a bad negative total is a duckling.
        assert.equal(stageFor(from - 1).id, id);
      }
      assert.equal(nextStage(from)?.id ?? null, EXPECTED_STAGES[i + 1]?.[0] ?? null);
    });
  });

  it('stays a pond legend forever, with no next stage', () => {
    assert.equal(stageFor(100_000).id, 'legend');
    assert.equal(nextStage(100_000), null);
  });
});

describe('items', () => {
  it('has the 12 items in unlock order', () => {
    assert.deepEqual(
      ITEMS.map((i) => [i.id, i.at, i.kind]),
      EXPECTED_ITEMS,
    );
  });

  for (const [id, at, kind] of EXPECTED_ITEMS) {
    it(`unlocks ${id} (${kind}) at exactly ${at} breaks, not ${at - 1}`, () => {
      const item = itemById(id);
      assert.equal(item.id, id);
      assert.equal(item.at, at);
      assert.equal(isUnlocked(id, at), true);
      assert.equal(isUnlocked(id, at - 1), false);
      assert.equal(ids(unlockedItems(at)).includes(id), true);
      assert.equal(ids(unlockedItems(at - 1)).includes(id), false);
      assert.equal(nextItem(at - 1)?.id, id);
      assert.notEqual(nextItem(at)?.id, id);
      assert.deepEqual(ids(unlocksBetween(at - 1, at).items), [id]);
    });
  }

  it('has nothing unlocked at the start and everything at 180', () => {
    assert.deepEqual(unlockedItems(0), []);
    assert.equal(nextItem(0)?.id, 'lilypad');
    assert.deepEqual(ids(unlockedItems(180)), ids(ITEMS));
    assert.equal(nextItem(180), null);
    assert.equal(nextItem(10_000), null);
  });
});

describe('countBreak', () => {
  const last = () => pond({ total: 3, lastAt: T0, name: 'Quackers', wearing: null, seen: 2 });

  it('always counts the first break ever', () => {
    const p = countBreak(defaultPond(), T0);
    assert.equal(p.total, 1);
    assert.equal(p.lastAt, T0);
  });

  it('does not count a break that ends 4:59 after the last one', () => {
    const p = last();
    assert.equal(countBreak(p, T0 + 4 * MINUTE + 59 * SEC), p);
  });

  it('counts a break that ends exactly 5:00 after the last one', () => {
    const p = countBreak(last(), T0 + 5 * MINUTE);
    assert.equal(p.total, 4);
    assert.equal(p.lastAt, T0 + 5 * MINUTE);
  });

  it('counts a break that ends 5:01 after the last one', () => {
    const p = countBreak(last(), T0 + 5 * MINUTE + SEC);
    assert.equal(p.total, 4);
    assert.equal(p.lastAt, T0 + 5 * MINUTE + SEC);
  });

  it('does not count a break one millisecond short of 5 minutes, or one ending at the same moment', () => {
    const p = last();
    assert.equal(countBreak(p, T0 + MIN_GAP_MS - 1), p);
    assert.equal(countBreak(p, T0), p);
  });

  it('keeps the name, hat and seen count, and leaves the old pond alone', () => {
    const p = pond({ total: 40, lastAt: T0, name: 'Quackers', wearing: 'beanie', seen: 38 });
    const copy = structuredClone(p);
    const next = countBreak(p, T0 + HOUR);
    assert.deepEqual(next, { total: 41, lastAt: T0 + HOUR, name: 'Quackers', wearing: 'beanie', seen: 38 });
    assert.deepEqual(p, copy);
  });

  it('ignores a break ending a moment before the last one (a small clock correction)', () => {
    const p = last();
    assert.equal(countBreak(p, T0 - 2 * SEC), p);
    assert.equal(countBreak(p, T0 - 4 * MINUTE), p);
  });

  it('still counts breaks after the clock went back a long way', () => {
    // A break counted while the clock was wrong (set ahead by hand, or a bad network time) leaves
    // lastAt in the future. countBreak compares the size of the gap either way, so breaks keep
    // counting once the clock is right, instead of none counting until it passes lastAt.
    const p = pond({ total: 10, lastAt: T0 + 24 * HOUR, seen: 10 });
    const next = countBreak(p, T0);
    assert.equal(next.total, 11);
    assert.equal(next.lastAt, T0);
  });

  it('counts at most one break per 5 minutes when "Take a break now" is spammed', () => {
    let p = defaultPond();
    // A break every 30 seconds for 30 minutes: 61 breaks, counted at 0, 5, 10, ... 30 minutes.
    for (let t = 0; t <= 30 * MINUTE; t += 30 * SEC) p = countBreak(p, T0 + t);
    assert.equal(p.total, 7);
    assert.equal(p.lastAt, T0 + 30 * MINUTE);
  });

  it('counts back-to-back 20-second breaks once every 5 minutes', () => {
    let p = defaultPond();
    // 180 breaks in an hour, each ending 20 s after the last.
    for (let t = 0; t < HOUR; t += 20 * SEC) p = countBreak(p, T0 + t);
    assert.equal(p.total, 12);
  });

  it('counts every break for someone following 20-minute reminders all day', () => {
    let p = defaultPond();
    // 20 minutes of work then a 20 s break, for 8 hours.
    for (let t = 0; t < 8 * HOUR; t += 20 * MINUTE + 20 * SEC) p = countBreak(p, T0 + t);
    assert.equal(p.total, Math.ceil((8 * HOUR) / (20 * MINUTE + 20 * SEC)));
  });

  it('never loses a break on the shortest reminder interval', () => {
    assert.equal(MIN_GAP_MS, 5 * MINUTE);
    assert.equal(MIN_GAP_MS, Math.min(...WORK_CHOICES) * MINUTE);
    let p = defaultPond();
    // Reminders every 5 minutes, each break started the moment it is due: ends exactly 5:00 apart.
    for (let k = 0; k < 24; k++) p = countBreak(p, T0 + k * MIN_GAP_MS);
    assert.equal(p.total, 24);
  });
});

describe('pondFrom', () => {
  const days = { '2026-10-20': 3, '2026-10-21': 12 };

  it('starts a fresh install at zero', () => {
    assert.deepEqual(pondFrom(undefined, {}), defaultPond());
  });

  it('gives an older save (no pond yet) every break it already took, all marked seen', () => {
    const p = pondFrom(undefined, days);
    assert.deepEqual(p, { total: 15, lastAt: 0, name: 'Jenny', wearing: null, seen: 15 });
    assert.equal(stageFor(p.total).id, 'fluffy');
    assert.equal(hasNew(p), false);
  });

  it('treats a null pond like a missing one', () => {
    assert.equal(pondFrom(null, days).total, 15);
  });

  it('treats a number, string or boolean in place of the pond like a missing one', () => {
    for (const junk of [42, 0, 'pond', '', true, false]) {
      assert.deepEqual(pondFrom(junk, days), pondFrom(undefined, days), String(junk));
    }
  });

  it('skips junk per-day counts when moving an older save over', () => {
    const junk = {
      a: 2,
      b: -1,
      c: 1.5,
      d: Number.NaN,
      e: '3',
      f: Number.POSITIVE_INFINITY,
      g: null,
      h: 0,
      i: 4,
    } as unknown as Record<string, number>;
    const p = pondFrom(undefined, junk);
    assert.equal(p.total, 6);
    assert.equal(p.seen, 6);
  });

  it('keeps a valid saved pond exactly as it was', () => {
    const saved = { total: 95, lastAt: T0, name: 'Quackers', wearing: 'bow', seen: 90 };
    assert.deepEqual(pondFrom(JSON.parse(JSON.stringify(saved)), days), saved);
  });

  it('uses the saved total, not the per-day counts, once a pond exists', () => {
    assert.equal(pondFrom({ total: 3 }, days).total, 3);
  });

  it('drops fields it does not know', () => {
    const p = pondFrom({ total: 5, lastAt: T0, name: 'Jenny', wearing: null, seen: 5, extra: 1, v: 2 }, {});
    assert.deepEqual(Object.keys(p).sort(), ['lastAt', 'name', 'seen', 'total', 'wearing']);
  });

  it('resets a negative total to 0', () => {
    const p = pondFrom({ total: -5, seen: 0 }, {});
    assert.equal(p.total, 0);
    assert.equal(p.seen, 0);
  });

  it('never keeps a fractional total', () => {
    const p = pondFrom({ total: 12.5 }, {});
    assert.ok(Number.isInteger(p.total), `total ${p.total}`);
    assert.ok(p.total >= 0 && p.total <= 12, `total ${p.total}`);
    assert.ok(p.seen <= p.total);
  });

  it('resets a NaN, infinite or text total to a whole number of breaks', () => {
    for (const total of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, null]) {
      assert.equal(pondFrom({ total }, {}).total, 0, String(total));
    }
    const text = pondFrom({ total: '12' }, {});
    assert.ok(Number.isInteger(text.total) && text.total >= 0);
  });

  it('never has seen more than the total', () => {
    const p = pondFrom({ total: 20, seen: 50 }, {});
    assert.equal(p.seen, 20);
    assert.equal(hasNew(p), false);
  });

  it('treats a missing or invalid seen count as everything seen', () => {
    for (const seen of [undefined, -3, 2.5, 'x', Number.NaN]) {
      assert.equal(pondFrom({ total: 20, seen }, {}).seen, 20, String(seen));
    }
    assert.equal(pondFrom({ total: 20, seen: 0 }, {}).seen, 0);
  });

  it('drops an unknown hat', () => {
    for (const wearing of ['crown', 'BEANIE', 5, {}, true]) {
      assert.equal(pondFrom({ total: 1000, wearing }, {}).wearing, null, String(wearing));
    }
  });

  it('drops a hat that is not unlocked yet', () => {
    assert.equal(pondFrom({ total: 39, wearing: 'beanie' }, {}).wearing, null);
    assert.equal(pondFrom({ total: 40, wearing: 'beanie' }, {}).wearing, 'beanie');
    assert.equal(pondFrom({ total: -1, wearing: 'beanie' }, {}).wearing, null);
  });

  it('drops a pond item saved as something the duck wears', () => {
    // A damaged save with { total: 100, wearing: 'frog' } must not load as a duck wearing a frog.
    // Like wear(), pondFrom only accepts items the duck can wear.
    const p = pondFrom({ total: 100, wearing: 'frog' }, {});
    assert.equal(p.wearing, null);
    assert.equal(describeDuck(p), 'Jenny, a young duck');
  });

  it('replaces a bad name and cleans a messy one', () => {
    for (const name of [undefined, null, '', '   ', 42, {}, ['Jenny']]) {
      assert.equal(pondFrom({ total: 1, name }, {}).name, 'Jenny', String(name));
    }
    assert.equal(pondFrom({ total: 1, name: '  Mr   Quack ' }, {}).name, 'Mr Quack');
    assert.equal(pondFrom({ total: 1, name: 'x'.repeat(30) }, {}).name, 'x'.repeat(20));
  });

  it('resets a bad last-break time to 0', () => {
    for (const lastAt of [-5, Number.NaN, Number.POSITIVE_INFINITY, '123', null, undefined]) {
      assert.equal(pondFrom({ total: 1, lastAt }, {}).lastAt, 0, String(lastAt));
    }
    assert.equal(pondFrom({ total: 1, lastAt: T0 }, {}).lastAt, T0);
  });
});

describe('cleanName', () => {
  it('trims and collapses spaces, tabs and new lines', () => {
    assert.equal(cleanName('  Jenny  '), 'Jenny');
    assert.equal(cleanName('Mr    Quack'), 'Mr Quack');
    assert.equal(cleanName('\tMr\n\n Quack\r\n'), 'Mr Quack');
    assert.equal(cleanName(' Jenny '), 'Jenny');
  });

  it('keeps an ordinary name as it is', () => {
    for (const name of ['Jenny', 'Sir Quacks-a-Lot', 'Ducky 2', "D'Artagnan", 'Zoë']) {
      assert.equal(cleanName(name), name);
    }
  });

  it('keeps a name of exactly 20 characters', () => {
    const name = 'abcdefghij klmnopqrs';
    assert.equal(name.length, MAX_NAME_LENGTH);
    assert.equal(cleanName(name), name);
  });

  it('cuts a 25+ character name to the first 20 characters', () => {
    assert.equal(MAX_NAME_LENGTH, 20);
    assert.equal(cleanName('abcdefghijklmnopqrstuvwxyz'), 'abcdefghijklmnopqrst');
    assert.equal(cleanName('Q'.repeat(500)), 'Q'.repeat(20));
  });

  it('counts the length after collapsing spaces', () => {
    // 20 characters once the double spaces become single ones.
    assert.equal(cleanName('a  b  c  d  e  f  g  h  i  j'), 'a b c d e f g h i j');
  });

  it('never ends with a space after cutting', () => {
    assert.equal(cleanName(`${'a'.repeat(19)} bcdef`), 'a'.repeat(19));
  });

  it('counts emoji as one character each and never splits one', () => {
    const ducks = cleanName('🦆'.repeat(25));
    assert.equal(ducks, '🦆'.repeat(20));
    assert.equal(Array.from(ducks).length, 20);
    const mixed = cleanName(`${'a'.repeat(19)}🦆🦆🦆`);
    assert.equal(mixed, `${'a'.repeat(19)}🦆`);
    assert.equal(mixed.isWellFormed(), true);
  });

  it('falls back to Jenny for an empty or blank name', () => {
    for (const blank of ['', ' ', '     ', '\t\n', '   ']) assert.equal(cleanName(blank), DEFAULT_DUCK_NAME);
  });

  it('falls back to Jenny for anything that is not text', () => {
    for (const junk of [undefined, null, 42, 0, true, {}, [], ['Jenny'], Symbol('x')]) {
      assert.equal(cleanName(junk), 'Jenny', String(junk));
    }
  });

  it('gives the same result when cleaned twice', () => {
    for (const raw of ['  a  b ', 'x'.repeat(40), '🦆'.repeat(30), `${'a'.repeat(19)} b`, '   ']) {
      assert.equal(cleanName(cleanName(raw)), cleanName(raw));
    }
  });
});

describe('rename', () => {
  it('renames the duck with a clean name and leaves the rest alone', () => {
    const p = pond({ total: 50, wearing: 'beanie', seen: 50 });
    const renamed = rename(p, '  Sir   Quacks  ');
    assert.deepEqual(renamed, { ...p, name: 'Sir Quacks' });
    assert.equal(p.name, 'Jenny');
  });

  it('never leaves the duck without a name', () => {
    assert.equal(rename(pond({ name: 'Quackers' }), '   ').name, 'Jenny');
    assert.equal(rename(pond({ name: 'Quackers' }), '').name, 'Jenny');
  });

  it('returns the same pond when the name does not change, so nothing is saved', () => {
    const p = pond({ name: 'Quackers' });
    assert.equal(rename(p, 'Quackers'), p);
    assert.equal(rename(p, '  Quackers '), p);
    assert.notEqual(rename(p, 'Quackers!'), p);
  });
});

describe('unlocksBetween', () => {
  const none = { stage: null, items: [] };

  it('finds nothing when the total did not grow', () => {
    assert.deepEqual(unlocksBetween(5, 5), none);
    assert.deepEqual(unlocksBetween(40, 39), none);
    assert.deepEqual(unlocksBetween(1000, 0), none);
  });

  it('includes the item at the new total, not one already had', () => {
    assert.deepEqual(ids(unlocksBetween(4, 5).items), ['lilypad']);
    assert.deepEqual(unlocksBetween(5, 6), none);
  });

  it('finds nothing for breaks that unlock nothing', () => {
    assert.deepEqual(unlocksBetween(0, 4), none);
    assert.deepEqual(unlocksBetween(181, 249), none);
  });

  it('does not report being a duckling as new', () => {
    assert.equal(unlocksBetween(0, 1).stage, null);
  });

  it('reports several items and a stage found at once', () => {
    const u = unlocksBetween(10, 45);
    assert.equal(u.stage?.id, 'fluffy');
    assert.deepEqual(ids(u.items), ['waterlily', 'frog', 'beanie']);
  });

  it('reports only the highest stage when several are crossed', () => {
    const u = unlocksBetween(60, 260);
    assert.equal(u.stage?.id, 'grown');
    assert.deepEqual(ids(u.items), ['boat', 'bow', 'snail', 'stones', 'goldfish', 'scarf']);
  });

  it('reports a stage with no item', () => {
    assert.deepEqual(unlocksBetween(14, 15), { stage: STAGES[1], items: [] });
    assert.equal(unlocksBetween(249, 250).stage?.id, 'grown');
    assert.equal(unlocksBetween(749, 750).stage?.id, 'legend');
    assert.equal(unlocksBetween(750, 751).stage, null);
  });

  it('finds everything going from zero to a pond legend', () => {
    const u = unlocksBetween(0, 10_000);
    assert.equal(u.stage?.id, 'legend');
    assert.deepEqual(ids(u.items), ids(ITEMS));
  });
});

describe('hasNew and markSeen', () => {
  it('has nothing new for a new duck', () => {
    assert.equal(hasNew(defaultPond()), false);
  });

  it('has something new after finding an item', () => {
    assert.equal(hasNew(pond({ total: 5, seen: 4 })), true);
    assert.equal(hasNew(pond({ total: 41, seen: 39 })), true);
  });

  it('has something new after reaching a stage', () => {
    assert.equal(hasNew(pond({ total: 15, seen: 14 })), true);
  });

  it('has nothing new when breaks were added but nothing was found', () => {
    assert.equal(hasNew(pond({ total: 10, seen: 6 })), false);
    assert.equal(hasNew(pond({ total: 200, seen: 181 })), false);
  });

  it('has nothing new when seen is ahead of the total', () => {
    assert.equal(hasNew(pond({ total: 5, seen: 100 })), false);
  });

  it('markSeen clears what is new without changing the old pond', () => {
    const p = pond({ total: 41, seen: 39 });
    const seen = markSeen(p);
    assert.equal(seen.seen, 41);
    assert.equal(hasNew(seen), false);
    assert.equal(p.seen, 39);
    assert.deepEqual(seen, { ...p, seen: 41 });
  });

  it('markSeen returns the same pond when everything was already seen', () => {
    const p = pond({ total: 41, seen: 41 });
    assert.equal(markSeen(p), p);
  });
});

describe('nextGoal', () => {
  /** What to look forward to from each mark, by hand: [total, label, at]. */
  const GOALS: [number, string, number][] = [
    [0, 'Lily pad', 5],
    [5, 'Fluffy duckling', 15],
    [15, 'Water lily', 20],
    [20, 'Frog friend', 30],
    [30, 'Beanie', 40],
    [40, 'Cattails', 50],
    [50, 'Dragonfly', 60],
    [60, 'Paper boat', 70],
    [70, 'Young duck', 75],
    [75, 'Bow', 90],
    [90, 'Snail', 100],
    [100, 'Stepping stones', 125],
    [125, 'Goldfish', 150],
    [150, 'Scarf', 180],
    [180, 'Grown duck', 250],
    [250, 'Pond legend', 750],
  ];

  it('names the next item or stage, with no progress yet, at every threshold', () => {
    assert.deepEqual(
      GOALS.map((g) => g[0]),
      MARKS.slice(0, -1),
    );
    for (const [total, label, at] of GOALS) {
      assert.deepEqual(nextGoal(total), { label, at, left: at - total, progress: 0 }, `at ${total}`);
    }
  });

  it('counts progress from the last thing found', () => {
    assert.deepEqual(nextGoal(10), { label: 'Fluffy duckling', at: 15, left: 5, progress: 0.5 });
    assert.deepEqual(nextGoal(72), { label: 'Young duck', at: 75, left: 3, progress: 0.4 });
    assert.deepEqual(nextGoal(80), { label: 'Bow', at: 90, left: 10, progress: 1 / 3 });
    assert.deepEqual(nextGoal(500), { label: 'Pond legend', at: 750, left: 250, progress: 0.5 });
  });

  it('is one break away just before the last stage', () => {
    const g = nextGoal(749);
    assert.equal(g?.label, 'Pond legend');
    assert.equal(g?.left, 1);
    assert.equal(g?.progress, 499 / 500);
  });

  it('has progress strictly between 0 and 1 between thresholds, for every total up to 749', () => {
    for (let total = 0; total < 750; total++) {
      const g = nextGoal(total);
      assert.ok(g, `goal at ${total}`);
      assert.ok(g.at > total, `at ${total}`);
      assert.equal(g.left, g.at - total, `left at ${total}`);
      assert.equal(g.at, MARKS.find((m) => m > total), `goal at ${total}`);
      if (MARKS.includes(total)) assert.equal(g.progress, 0, `progress at ${total}`);
      else assert.ok(g.progress > 0 && g.progress < 1, `progress ${g.progress} at ${total}`);
    }
  });

  it('grows progress by the same step each break toward a goal', () => {
    const steps = [251, 252, 253].map((t) => nextGoal(t)!.progress);
    assert.ok(steps[0]! < steps[1]! && steps[1]! < steps[2]!);
    assert.ok(Math.abs(steps[1]! - steps[0]! - (steps[2]! - steps[1]!)) < 1e-12);
  });

  it('has no goal once everything is found', () => {
    assert.equal(nextGoal(750), null);
    assert.equal(nextGoal(751), null);
    assert.equal(nextGoal(1_000_000), null);
  });
});

describe('describeDuck', () => {
  it('describes each stage', () => {
    assert.equal(describeDuck(pond({ total: 0 })), 'Jenny, a duckling');
    assert.equal(describeDuck(pond({ total: 15 })), 'Jenny, a fluffy duckling');
    assert.equal(describeDuck(pond({ total: 75 })), 'Jenny, a young duck');
    assert.equal(describeDuck(pond({ total: 250 })), 'Jenny, a grown duck');
    assert.equal(describeDuck(pond({ total: 750 })), 'Jenny, a pond legend');
  });

  it('uses "an" before a vowel and "a" otherwise, for every stage', () => {
    for (const s of STAGES) {
      const lower = s.name.toLowerCase();
      const article = /^[aeiou]/.test(lower) ? 'an' : 'a';
      assert.equal(describeDuck(pond({ total: s.from })), `Jenny, ${article} ${lower}`);
    }
  });

  it('describes what the duck is wearing', () => {
    assert.equal(describeDuck(pond({ total: 75, wearing: 'beanie' })), 'Jenny, a young duck wearing a beanie');
    assert.equal(describeDuck(pond({ total: 90, wearing: 'bow' })), 'Jenny, a young duck wearing a bow');
    assert.equal(describeDuck(pond({ total: 750, wearing: 'scarf' })), 'Jenny, a pond legend wearing a scarf');
  });

  it('reads right with every wearable item', () => {
    for (const item of ITEMS.filter((i) => i.kind === 'wear')) {
      const lower = item.name.toLowerCase();
      const article = /^[aeiou]/.test(lower) ? 'an' : 'a';
      assert.equal(describeDuck(pond({ total: 1000, wearing: item.id })), `Jenny, a pond legend wearing ${article} ${lower}`);
    }
  });

  it("uses the duck's own name", () => {
    assert.equal(describeDuck(pond({ total: 300, name: 'Sir Quacks' })), 'Sir Quacks, a grown duck');
  });
});

describe('wear', () => {
  it('puts on an unlocked hat', () => {
    const p = wear(pond({ total: 40 }), 'beanie');
    assert.equal(p.wearing, 'beanie');
  });

  it('refuses a hat that is still locked, returning the same pond', () => {
    const p = pond({ total: 39 });
    assert.equal(wear(p, 'beanie'), p);
    const q = pond({ total: 179, wearing: 'bow' });
    assert.equal(wear(q, 'scarf'), q);
  });

  it('refuses pond items, even unlocked ones', () => {
    const p = pond({ total: 1000 });
    for (const item of ITEMS.filter((i) => i.kind === 'pond')) assert.equal(wear(p, item.id), p, item.id);
  });

  it('takes a hat off when it is chosen again', () => {
    const on = wear(pond({ total: 100 }), 'bow');
    assert.equal(on.wearing, 'bow');
    assert.equal(wear(on, 'bow').wearing, null);
  });

  it('swaps one hat for another', () => {
    const p = wear(pond({ total: 200, wearing: 'beanie' }), 'scarf');
    assert.equal(p.wearing, 'scarf');
  });

  it('takes off whatever is worn with null', () => {
    assert.equal(wear(pond({ total: 200, wearing: 'beanie' }), null).wearing, null);
    assert.deepEqual(wear(pond({ total: 200 }), null), pond({ total: 200 }));
  });

  it('leaves the old pond alone', () => {
    const p = pond({ total: 200, wearing: 'beanie' });
    const copy = structuredClone(p);
    wear(p, 'scarf');
    wear(p, 'beanie');
    wear(p, null);
    assert.deepEqual(p, copy);
  });
});

describe('invariants', () => {
  it('keeps ITEMS sorted by unlock count, with unique ids and counts', () => {
    for (let i = 1; i < ITEMS.length; i++) assert.ok(ITEMS[i]!.at > ITEMS[i - 1]!.at, ITEMS[i]!.id);
    assert.equal(new Set(ids(ITEMS)).size, ITEMS.length);
    for (const item of ITEMS) {
      assert.ok(Number.isInteger(item.at) && item.at > 0, item.id);
      assert.ok(item.kind === 'pond' || item.kind === 'wear', item.id);
      assert.equal(itemById(item.id), item);
    }
  });

  it('keeps STAGES sorted from 0, with unique ids', () => {
    assert.equal(STAGES[0]!.from, 0);
    for (let i = 1; i < STAGES.length; i++) assert.ok(STAGES[i]!.from > STAGES[i - 1]!.from, STAGES[i]!.id);
    assert.equal(new Set(ids(STAGES)).size, STAGES.length);
  });

  it('writes item and stage names in plain sentence case', () => {
    for (const { name } of [...ITEMS, ...STAGES]) {
      assert.match(name, /^\p{Lu}[^A-Z]*$/u, name);
      assert.doesNotMatch(name, /\p{Extended_Pictographic}/u, name);
      assert.equal(name, name.trim().replace(/ {2,}/g, ' '), name);
      assert.ok(name.length <= MAX_NAME_LENGTH, name);
    }
  });

  it('starts every duck as Jenny with nothing, in a fresh object each time', () => {
    const a = defaultPond();
    assert.deepEqual(a, { total: 0, lastAt: 0, name: 'Jenny', wearing: null, seen: 0 });
    assert.equal(DEFAULT_DUCK_NAME, 'Jenny');
    assert.equal(cleanName(DEFAULT_DUCK_NAME), DEFAULT_DUCK_NAME);
    a.total = 99;
    assert.equal(defaultPond().total, 0);
  });
});
