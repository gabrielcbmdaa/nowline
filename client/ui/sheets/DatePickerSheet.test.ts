import { describe, expect, it } from 'vitest';
import { addDays, dateKeyToMidnight, weekdayOf } from '../../domain/dates';
import { monthGrid } from './DatePickerSheet';

const KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const ANCHORS = [
  '2026-09-15',
  '2026-02-14',
  '2028-02-29',
  '2026-11-01',
  '2026-12-31',
];

function inMonthDays(keys: string[], anchor: string): number[] {
  const month = dateKeyToMidnight(anchor).getMonth();
  return keys
    .filter((key) => dateKeyToMidnight(key).getMonth() === month)
    .map((key) => dateKeyToMidnight(key).getDate());
}

describe('monthGrid', () => {
  it('returns exactly 42 consecutive YYYY-MM-DD keys starting on Monday', () => {
    for (const anchor of ANCHORS) {
      const keys = monthGrid(anchor);
      expect(keys).toHaveLength(42);
      expect(weekdayOf(keys[0])).toBe(1);
      expect(keys).toContain(anchor);
      for (const key of keys) {
        expect(key).toMatch(KEY_PATTERN);
      }
      for (let index = 1; index < keys.length; index++) {
        expect(keys[index]).toBe(addDays(keys[index - 1], 1));
      }
    }
  });

  it('covers day 1 through the real month length for September 2026 (30 days, starts Tuesday)', () => {
    const keys = monthGrid('2026-09-15');
    expect(inMonthDays(keys, '2026-09-15')).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('covers day 1 through 28 for February 2026', () => {
    const keys = monthGrid('2026-02-14');
    expect(inMonthDays(keys, '2026-02-14')).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
  });

  it('covers day 1 through 29 for February 2028 (leap year)', () => {
    const keys = monthGrid('2028-02-29');
    expect(inMonthDays(keys, '2028-02-29')).toEqual(Array.from({ length: 29 }, (_, i) => i + 1));
  });

  it('covers day 1 through 30 for November 2026 (starts Sunday)', () => {
    const keys = monthGrid('2026-11-01');
    expect(inMonthDays(keys, '2026-11-01')).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('covers day 1 through 31 for December 2026 and crosses into January 2027', () => {
    const keys = monthGrid('2026-12-31');
    expect(inMonthDays(keys, '2026-12-31')).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
    expect(keys.some((key) => key.startsWith('2027-01-'))).toBe(true);
  });
});
