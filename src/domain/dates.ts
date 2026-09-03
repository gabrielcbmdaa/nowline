/**
 * Days are identified by their local calendar date, never by a UTC instant:
 * comparing in UTC moves a 23:30 block to the next day for anyone west of
 * Greenwich.
 */

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dateKeyToMidnight(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export function addDays(key: string, days: number): string {
  const date = dateKeyToMidnight(key);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

export function weekdayOf(key: string): number {
  return dateKeyToMidnight(key).getDay();
}

/** Weeks run Monday to Sunday. */
export function startOfWeekKey(key: string): string {
  const weekday = weekdayOf(key);
  const daysSinceMonday = (weekday + 6) % 7;
  return addDays(key, -daysSinceMonday);
}

export function minutesSinceMidnight(date: Date, key: string): number {
  const midnight = dateKeyToMidnight(key);
  return (date.getTime() - midnight.getTime()) / 60000;
}

export function atMinute(key: string, minute: number): Date {
  const date = dateKeyToMidnight(key);
  date.setMinutes(date.getMinutes() + minute);
  return date;
}

export function todayKey(now: Date): string {
  return toDateKey(now);
}

export function compareDateKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
