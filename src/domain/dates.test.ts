import { describe, expect, it } from 'vitest';
import {
  addDays,
  atMinute,
  compareDateKeys,
  dateKeyToMidnight,
  minutesSinceMidnight,
  startOfWeekKey,
  toDateKey,
  weekdayOf,
} from './dates';

describe('dates', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(toDateKey(new Date(2026, 8, 3, 23, 30))).toBe('2026-09-03');
    expect(toDateKey(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01');
  });

  it('uses local midnight, not UTC, so late blocks stay on their day', () => {
    const midnight = dateKeyToMidnight('2026-09-03');
    expect(midnight.getFullYear()).toBe(2026);
    expect(midnight.getMonth()).toBe(8);
    expect(midnight.getDate()).toBe(3);
    expect(midnight.getHours()).toBe(0);
  });

  it('adds and subtracts days across a month boundary', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
    expect(addDays('2026-09-03', 0)).toBe('2026-09-03');
  });

  it('reports the weekday with Sunday as zero', () => {
    expect(weekdayOf('2026-09-07')).toBe(1); // a Monday
    expect(weekdayOf('2026-09-06')).toBe(0); // a Sunday
  });

  it('starts the week on Monday', () => {
    expect(startOfWeekKey('2026-09-03')).toBe('2026-08-31');
    expect(startOfWeekKey('2026-08-31')).toBe('2026-08-31');
    expect(startOfWeekKey('2026-09-06')).toBe('2026-08-31');
  });

  it('converts a timestamp into minutes from its day start', () => {
    expect(minutesSinceMidnight(new Date(2026, 8, 3, 5, 30), '2026-09-03')).toBe(330);
    expect(minutesSinceMidnight(new Date(2026, 8, 4, 0, 30), '2026-09-03')).toBe(1470);
  });

  it('builds a timestamp at a given minute of a day', () => {
    const at = atMinute('2026-09-03', 330);
    expect(at.getHours()).toBe(5);
    expect(at.getMinutes()).toBe(30);
  });

  it('orders date keys as plain strings', () => {
    expect(compareDateKeys('2026-09-03', '2026-09-04')).toBeLessThan(0);
    expect(compareDateKeys('2026-09-04', '2026-09-03')).toBeGreaterThan(0);
    expect(compareDateKeys('2026-09-03', '2026-09-03')).toBe(0);
  });
});
