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

/**
 * Minutes of the wall clock, not minutes of elapsed time. The two differ on the
 * days a clock change makes 23 or 25 hours long, and the app stores wall clock:
 * atMinute builds an instant from calendar fields, so this has to invert that,
 * or a 10:00 block lands at 09:00 twice a year. The offset difference between
 * the two instants is exactly the jump, and is zero on every other day.
 */
export function minutesSinceMidnight(date: Date, key: string): number {
  const midnight = dateKeyToMidnight(key);
  const jump = (date.getTimezoneOffset() - midnight.getTimezoneOffset()) * 60000;
  return (date.getTime() - midnight.getTime() - jump) / 60000;
}

/**
 * How many marks of the grid separate two instants, which is not how much time
 * passed between them. The grid is always 24 hours tall, so a block is placed by
 * asking "which mark?" at both ends; asking "how long?" at the far end is what
 * draws a session that stopped at 03:30 as ending at 04:30 on the day the clocks
 * go back. On every other day the two questions have the same answer, which is
 * exactly why the difference is easy to miss.
 */
export function wallClockMinutesBetween(start: Date, end: Date, key: string): number {
  return minutesSinceMidnight(end, key) - minutesSinceMidnight(start, key);
}

export function atMinute(key: string, minute: number): Date {
  const date = dateKeyToMidnight(key);
  date.setMinutes(date.getMinutes() + minute);
  return date;
}

export function compareDateKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
