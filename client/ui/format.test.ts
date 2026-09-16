import { describe, expect, it } from 'vitest';
import {
  accessibleBlockName,
  formatDayGutterHeading,
  formatTimeWithMeridiem,
  minuteToTimeValue,
  timeValueToMinute,
} from './format';

describe('minuteToTimeValue', () => {
  it('pads both halves so <input type="time"> accepts the value', () => {
    expect(minuteToTimeValue(0)).toBe('00:00');
    expect(minuteToTimeValue(555)).toBe('09:15');
    expect(minuteToTimeValue(1439)).toBe('23:59');
  });
});

describe('timeValueToMinute', () => {
  it('reads a well formed time', () => {
    expect(timeValueToMinute('00:00')).toBe(0);
    expect(timeValueToMinute('09:15')).toBe(555);
    expect(timeValueToMinute('23:59')).toBe(1439);
  });

  it('round trips every minute of the day', () => {
    for (let minute = 0; minute < 1440; minute++) {
      expect(timeValueToMinute(minuteToTimeValue(minute))).toBe(minute);
    }
  });

  /**
   * An emptied time field arrives as ''. Returning 0 there would silently persist a
   * block starting at midnight, and returning NaN unchecked once wrote a plan with a
   * null duration that rendered as "9:15 - 12:NaN".
   */
  it('returns NaN for anything that is not a real time', () => {
    for (const value of ['', '9', '09:', ':15', 'ab:cd', '24:00', '12:60', '09:15:30']) {
      expect(timeValueToMinute(value)).toBeNaN();
    }
  });
});

describe('formatTimeWithMeridiem', () => {
  it('uses AM before noon, including midnight', () => {
    expect(formatTimeWithMeridiem(new Date(2026, 8, 14, 0, 15))).toBe('12:15 AM');
    expect(formatTimeWithMeridiem(new Date(2026, 8, 14, 11, 30))).toBe('11:30 AM');
  });

  it('uses PM from noon onward', () => {
    expect(formatTimeWithMeridiem(new Date(2026, 8, 14, 12, 0))).toBe('12:00 PM');
    expect(formatTimeWithMeridiem(new Date(2026, 8, 14, 12, 15))).toBe('12:15 PM');
    expect(formatTimeWithMeridiem(new Date(2026, 8, 5, 23, 50))).toBe('11:50 PM');
  });
});

describe('formatDayGutterHeading', () => {
  const now = new Date(2026, 8, 15, 12, 0);

  it('returns Today with no second line', () => {
    expect(formatDayGutterHeading('2026-09-15', now)).toEqual({
      weekday: 'Today',
      monthDay: null,
    });
  });

  it('puts the weekday on the first line and month plus day on the second', () => {
    expect(formatDayGutterHeading('2026-09-16', now)).toEqual({
      weekday: 'Wed',
      monthDay: 'Sep 16',
    });
  });
});

describe('accessibleBlockName', () => {
  it('joins the title and both meridiems, matching the crossing fixture', () => {
    expect(
      accessibleBlockName(
        'Late session',
        new Date(2026, 8, 5, 23, 50),
        new Date(2026, 8, 6, 0, 20),
      ),
    ).toBe('Late session, 11:50 PM - 12:20 AM');
  });
});
