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
