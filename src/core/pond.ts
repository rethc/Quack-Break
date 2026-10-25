// The duck pet: it grows, and the pond fills up, with every break. Pure functions, no React Native.
// Nothing is ever lost: skipping or missing breaks never takes anything away.
import { MINUTE } from './schedule.ts';

export type StageId = 'duckling' | 'fluffy' | 'young' | 'grown' | 'legend';

export type Stage = { id: StageId; name: string; from: number };

/** Growth stages, by breaks counted toward the pond. */
export const STAGES: readonly Stage[] = [
  { id: 'duckling', name: 'Duckling', from: 0 },
  { id: 'fluffy', name: 'Fluffy duckling', from: 15 },
  { id: 'young', name: 'Young duck', from: 75 },
  { id: 'grown', name: 'Grown duck', from: 250 },
  { id: 'legend', name: 'Pond legend', from: 750 },
];

export type ItemId =
  | 'lilypad'
  | 'waterlily'
  | 'frog'
  | 'beanie'
  | 'cattails'
  | 'dragonfly'
  | 'boat'
  | 'bow'
  | 'snail'
  | 'stones'
  | 'goldfish'
  | 'scarf';

/** "pond" items appear in the pond; "wear" items are hats and scarves the duck can wear. */
export type Item = { id: ItemId; name: string; at: number; kind: 'pond' | 'wear' };

/** Things to find, in the order they unlock. */
export const ITEMS: readonly Item[] = [
  { id: 'lilypad', name: 'Lily pad', at: 5, kind: 'pond' },
  { id: 'waterlily', name: 'Water lily', at: 20, kind: 'pond' },
  { id: 'frog', name: 'Frog friend', at: 30, kind: 'pond' },
  { id: 'beanie', name: 'Beanie', at: 40, kind: 'wear' },
  { id: 'cattails', name: 'Cattails', at: 50, kind: 'pond' },
  { id: 'dragonfly', name: 'Dragonfly', at: 60, kind: 'pond' },
  { id: 'boat', name: 'Paper boat', at: 70, kind: 'pond' },
  { id: 'bow', name: 'Bow', at: 90, kind: 'wear' },
  { id: 'snail', name: 'Snail', at: 100, kind: 'pond' },
  { id: 'stones', name: 'Stepping stones', at: 125, kind: 'pond' },
  { id: 'goldfish', name: 'Goldfish', at: 150, kind: 'pond' },
  { id: 'scarf', name: 'Scarf', at: 180, kind: 'wear' },
];

export const DEFAULT_DUCK_NAME = 'Jenny';
export const MAX_NAME_LENGTH = 20;

/**
 * Breaks closer together than this don't count toward the pond (they still count as breaks
 * today), so tapping "Take a break now" over and over doesn't grow the duck. It's the shortest
 * reminder interval, so no one following their reminders ever loses a break.
 */
export const MIN_GAP_MS = 5 * MINUTE;

export type PondState = {
  /** Breaks counted toward growth and items. */
  total: number;
  /** When the last counted break ended (0 if none). */
  lastAt: number;
  name: string;
  /** The hat or scarf the duck is wearing. */
  wearing: ItemId | null;
  /** `total` when the user last looked at their pond, to mark what's new. */
  seen: number;
};

export function defaultPond(): PondState {
  return { total: 0, lastAt: 0, name: DEFAULT_DUCK_NAME, wearing: null, seen: 0 };
}

const ITEM_IDS: readonly string[] = ITEMS.map((i) => i.id);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
/** A saved count: whole and not negative (a fraction from a damaged file rounds down). */
const toCount = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
/** Characters that take up no space (zero-width, byte-order marks, controls). */
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u200B\u200E\u200F\u2060\uFEFF]/g;
// Joiners hold emoji like the woman astronaut (woman + joiner + rocket) together, and shape some
// scripts, so they're kept, but only between two characters.
const LOOSE_JOINERS = /(^|\s)[\u200C\u200D]+|[\u200C\u200D]+(?=\s|$)/g;
const JOINER_RUNS = /([\u200C\u200D])[\u200C\u200D]+/g;
const TRAILING_JOINERS = /[\u200C\u200D]+$/;

/** A clean duck name: trimmed, spaces collapsed, at most MAX_NAME_LENGTH characters, never empty. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_DUCK_NAME;
  const visible = raw
    .replace(INVISIBLE, '')
    .replace(/\s+/g, ' ')
    .replace(LOOSE_JOINERS, '$1')
    .replace(JOINER_RUNS, '$1')
    .trim();
  // Cutting to length can leave a joiner with nothing after it.
  const name = Array.from(visible).slice(0, MAX_NAME_LENGTH).join('').replace(TRAILING_JOINERS, '').trim();
  return name || DEFAULT_DUCK_NAME;
}

/**
 * The pond from the saved file. Older saves had no pond: they start with every break they've
 * already taken (from the per-day counts), so existing users don't start from zero.
 */
export function pondFrom(saved: unknown, days: Record<string, number>): PondState {
  if (!saved || typeof saved !== 'object') {
    const total = Object.values(days).reduce((sum, n) => sum + (isCount(n) ? n : 0), 0);
    return { ...defaultPond(), total, seen: total };
  }
  const raw = saved as Partial<PondState>;
  const total = toCount(raw.total) ?? 0;
  const wearing =
    typeof raw.wearing === 'string' &&
    ITEM_IDS.includes(raw.wearing) &&
    itemById(raw.wearing as ItemId).kind === 'wear' &&
    isUnlocked(raw.wearing as ItemId, total)
      ? (raw.wearing as ItemId)
      : null;
  return {
    total,
    lastAt: typeof raw.lastAt === 'number' && Number.isFinite(raw.lastAt) && raw.lastAt >= 0 ? raw.lastAt : 0,
    name: cleanName(raw.name),
    wearing,
    seen: isCount(raw.seen) ? Math.min(raw.seen, total) : total,
  };
}

/**
 * Count a finished break (it ended at `endsAt`) toward the pond, unless it came too soon after
 * the last one. "Too soon" works both ways, so a clock that was wrong (and counted a break in
 * the future) doesn't stop breaks counting until the real time catches up.
 */
export function countBreak(pond: PondState, endsAt: number): PondState {
  if (pond.lastAt > 0 && Math.abs(endsAt - pond.lastAt) < MIN_GAP_MS) return pond;
  return { ...pond, total: pond.total + 1, lastAt: endsAt };
}

export function stageFor(total: number): Stage {
  let stage = STAGES[0]!;
  for (const s of STAGES) if (total >= s.from) stage = s;
  return stage;
}

export function nextStage(total: number): Stage | null {
  return STAGES.find((s) => s.from > total) ?? null;
}

export function itemById(id: ItemId): Item {
  return ITEMS.find((i) => i.id === id)!;
}

export function isUnlocked(id: ItemId, total: number): boolean {
  return total >= itemById(id).at;
}

export function unlockedItems(total: number): Item[] {
  return ITEMS.filter((i) => total >= i.at);
}

export function nextItem(total: number): Item | null {
  return ITEMS.find((i) => i.at > total) ?? null;
}

/** What became new between two totals: a stage reached and items found. */
export function unlocksBetween(before: number, after: number): { stage: Stage | null; items: Item[] } {
  if (after <= before) return { stage: null, items: [] };
  const stage = stageFor(after);
  return {
    stage: stage.from > before ? stage : null,
    items: ITEMS.filter((i) => i.at > before && i.at <= after),
  };
}

/** True when something was found since the user last looked at the pond. */
export function hasNew(pond: PondState): boolean {
  const u = unlocksBetween(pond.seen, pond.total);
  return u.stage !== null || u.items.length > 0;
}

/**
 * The next thing to look forward to (item or stage, whichever comes first), with progress
 * from the previous one. Null once everything is found.
 */
export function nextGoal(total: number): { label: string; at: number; left: number; progress: number } | null {
  const item = nextItem(total);
  const stage = nextStage(total);
  const goal =
    item && (!stage || item.at <= stage.from)
      ? { label: item.name, at: item.at }
      : stage
        ? { label: stage.name, at: stage.from }
        : null;
  if (!goal) return null;
  const marks = [0, ...ITEMS.map((i) => i.at), ...STAGES.map((s) => s.from)].filter((m) => m <= total);
  const from = Math.max(...marks);
  return { ...goal, left: goal.at - total, progress: (total - from) / (goal.at - from) };
}

/** "Jenny is a young duck" and the like. */
export function describeDuck(pond: PondState): string {
  const stage = stageFor(pond.total).name.toLowerCase();
  const article = /^[aeiou]/.test(stage) ? 'an' : 'a';
  const wearing = pond.wearing ? ` wearing a ${itemById(pond.wearing).name.toLowerCase()}` : '';
  return `${pond.name}, ${article} ${stage}${wearing}`;
}

export function wear(pond: PondState, id: ItemId | null): PondState {
  if (id === null) return { ...pond, wearing: null };
  const item = ITEMS.find((i) => i.id === id);
  if (!item || item.kind !== 'wear' || pond.total < item.at) return pond;
  return { ...pond, wearing: pond.wearing === id ? null : id };
}

/** Returns the same object when the cleaned name is the one it already has. */
export function rename(pond: PondState, name: string): PondState {
  const clean = cleanName(name);
  return clean === pond.name ? pond : { ...pond, name: clean };
}

export function markSeen(pond: PondState): PondState {
  return pond.seen === pond.total ? pond : { ...pond, seen: pond.total };
}
