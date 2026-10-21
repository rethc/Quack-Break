import { MINUTE } from '@/core/schedule';

/** "14 min", "1 h 5 min". Rounds up so it never says 0 while time remains. */
export function formatCountdown(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / MINUTE));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Screen-reader friendly version of formatCountdown. */
export function spokenCountdown(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / MINUTE));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const parts = [];
  if (h) parts.push(`${h} ${h === 1 ? 'hour' : 'hours'}`);
  if (m) parts.push(`${m} ${m === 1 ? 'minute' : 'minutes'}`);
  return parts.join(' ');
}

/** When the minute shown by formatCountdown(target - now) next changes. */
export function nextMinuteChange(target: number, now: number): number {
  const remaining = target - now;
  if (remaining <= 0) return now + MINUTE;
  const shown = Math.ceil(remaining / MINUTE);
  return target - (shown - 1) * MINUTE;
}

export function formatClock(t: number): string {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatMinuteOfDay(min: number): string {
  const d = new Date();
  d.setHours(Math.floor(min / 60), min % 60, 0, 0);
  return formatClock(d.getTime());
}
