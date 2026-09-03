import { describe, expect, it } from 'vitest';
import { minuteToTimeValue, timeValueToMinute } from './format';

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
