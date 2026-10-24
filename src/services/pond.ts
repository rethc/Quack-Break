// User actions for the duck pet: what it wears, its name, and marking the pond as seen.
import type { ItemId } from '@/core/pond';
import { markPondSeen, renameDuck, wearItem } from '@/core/transitions';

import { updateData } from './storage';

export function wearNow(id: ItemId | null) {
  updateData((d) => wearItem(d, id));
}

export function renameNow(name: string) {
  updateData((d) => renameDuck(d, name));
}

export function markPondSeenNow() {
  updateData((d) => markPondSeen(d));
}
