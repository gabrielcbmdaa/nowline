import { dateKeyToMidnight, toDateKey } from '../domain/dates';

/** Block labels read "5:00 - 7:00": no meridiem, matching the design. */
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
