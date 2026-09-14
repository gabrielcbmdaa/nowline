import { dateKeyToMidnight, toDateKey } from '../domain/dates';

/**
 * Block labels read "5:00 - 7:00": no meridiem, matching the design. The half of the
 * clock is the hour gutter's job, and a block that crosses midnight is no exception
 * (decided 2026-09-14): a lunch at 11:30-12:15 and a late session at 23:30-00:15 both
 * read "11:30 - 12:15", twelve hours apart on the grid, and nobody misses AM/PM across
 * noon. What is new at midnight is that the end belongs to the next day, and the block
 * already says so by being drawn across the day separator. Six more characters here
 * would come out of the title, which is the part that gives way on the smallest blocks.
 */
export function formatTime(date: Date): string {
  const hour = date.getHours() % 12 || 12;
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hour}:${minutes}`;
}

/** Hour gutter labels read "5 AM", "12 PM". */
export function formatHourLabel(hour: number): string {
  const display = hour % 12 || 12;
  return `${display} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function formatDayHeading(dateKey: string, now: Date): string {
  if (dateKey === toDateKey(now)) return 'Today';
  return dateKeyToMidnight(dateKey).toLocaleDateString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/** `<input type="time">` speaks 24-hour "HH:MM". */
export function minuteToTimeValue(minute: number): string {
  const hours = Math.floor(minute / 60);
  const minutes = minute % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Returns NaN for anything that is not "HH:MM". An emptied time field reaches here
 * as '', and a silent 0 would persist a block the user never described.
 */
export function timeValueToMinute(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return Number.NaN;
  return hours * 60 + minutes;
}
