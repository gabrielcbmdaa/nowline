import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/**
 * The property, which names no date at all: a minute turned into an instant and
 * back has to survive the round trip. Whichever days are short or long, they are
 * in here somewhere. A test that hardcoded the transition days would be only as
 * right as whoever looked them up.
 */
function daysThatDoNotRoundTrip(year: number): string[] {
  const broken: string[] = [];
  let key = `${year}-01-01`;

  while (key < `${year + 1}-01-01`) {
    for (const minute of [0, 10 * 60, 23 * 60 + 59]) {
      if (minutesSinceMidnight(atMinute(key, minute), key) !== minute) {
        broken.push(`${key} at ${minute}`);
      }
    }
    key = addDays(key, 1);
  }

  return broken;
}

/** Runs in Europe/Madrid; vite.config.ts pins the zone for the whole suite. */
describe('minutes and wall clock across a daylight saving change', () => {
  it('round-trips every minute of every day of a year', () => {
    expect(daysThatDoNotRoundTrip(2026)).toEqual([]);
  });

  /** The same failure spelled out, for whoever reads the property test and asks which days. */
  it('keeps a 10:00 block at 10:00 on the day the clocks move', () => {
    // Confirmed against the IANA database: Madrid jumps 02:00 -> 03:00 on 2026-03-29
    // and falls 03:00 -> 02:00 on 2026-10-25.
    expect(minutesSinceMidnight(new Date(2026, 2, 29, 10, 0), '2026-03-29')).toBe(600);
    expect(minutesSinceMidnight(new Date(2026, 9, 25, 10, 0), '2026-10-25')).toBe(600);
  });
});

/**
 * Only the zone changes here. Madrid moves its clocks by a whole hour, so it cannot
 * tell a correct jump from one that assumes sixty minutes. Lord Howe Island moves
 * them by half of one, which is the smallest thing that separates the two.
 *
 * Declared locally rather than pulling in @types/node, which would put process and
 * Buffer in scope for the browser code as well.
 */
declare const process: { env: { TZ?: string } };

describe('a clock change that is not a whole hour', () => {
  const pinnedTimezone = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'Australia/Lord_Howe';
  });

  afterAll(() => {
    process.env.TZ = pinnedTimezone;
  });

  it('round-trips every minute of every day of a year there too', () => {
    expect(daysThatDoNotRoundTrip(2026)).toEqual([]);
  });

  it('keeps a 10:00 block at 10:00 on both half-hour changes', () => {
    // Confirmed against the IANA database: Lord Howe springs 02:00 -> 02:30 on
    // 2026-10-04 and falls 02:00 -> 01:30 on 2026-04-05.
    expect(minutesSinceMidnight(new Date(2026, 9, 4, 10, 0), '2026-10-04')).toBe(600);
    expect(minutesSinceMidnight(new Date(2026, 3, 5, 10, 0), '2026-04-05')).toBe(600);
  });
});
