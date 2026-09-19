import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIXELS_PER_HOUR,
  MAX_PIXELS_PER_HOUR,
  MIN_PIXELS_PER_HOUR,
  clampMinute,
  clampScale,
  dayHeight,
  floorToQuarterHour,
  minuteToPixel,
  pixelToMinute,
  snapToQuarterHour,
} from './geometry';

describe('geometry', () => {
  it('puts one pixel to one minute at the default scale, so 5:30 is pixel 330', () => {
    expect(minuteToPixel(330, DEFAULT_PIXELS_PER_HOUR)).toBe(330);
  });

  it('spans a full day at every scale', () => {
    expect(DEFAULT_PIXELS_PER_HOUR).toBe(60);
    // 1440 is also MINUTES_PER_DAY: at one pixel a minute the two agree.
    expect(dayHeight(DEFAULT_PIXELS_PER_HOUR)).toBe(1440);
    expect(dayHeight(MIN_PIXELS_PER_HOUR)).toBe(720);
    expect(dayHeight(MAX_PIXELS_PER_HOUR)).toBe(3360);
    for (const scale of [MIN_PIXELS_PER_HOUR, DEFAULT_PIXELS_PER_HOUR, MAX_PIXELS_PER_HOUR]) {
      expect(minuteToPixel(1440, scale)).toBe(dayHeight(scale));
    }
  });

  it('round-trips minutes through pixels at every scale', () => {
    for (const scale of [MIN_PIXELS_PER_HOUR, DEFAULT_PIXELS_PER_HOUR, 97, MAX_PIXELS_PER_HOUR]) {
      for (const minute of [0, 1, 330, 719, 1439]) {
        expect(pixelToMinute(minuteToPixel(minute, scale), scale)).toBeCloseTo(minute, 10);
      }
    }
  });

  it('clamps the scale to the range the calendar allows', () => {
    expect(clampScale(10)).toBe(MIN_PIXELS_PER_HOUR);
    expect(clampScale(500)).toBe(MAX_PIXELS_PER_HOUR);
    expect(clampScale(97)).toBe(97);
    // Both limits are whole keyboard steps, so the ladder never gets clipped.
    expect(clampScale(MIN_PIXELS_PER_HOUR)).toBe(30);
    expect(clampScale(MAX_PIXELS_PER_HOUR)).toBe(140);
  });

  it('snaps to the nearest quarter hour', () => {
    expect(snapToQuarterHour(322)).toBe(315);
    expect(snapToQuarterHour(323)).toBe(330);
    expect(snapToQuarterHour(330)).toBe(330);
  });

  it('floors to the quarter hour when creating', () => {
    expect(floorToQuarterHour(324)).toBe(315);
    expect(floorToQuarterHour(330)).toBe(330);
    expect(floorToQuarterHour(0)).toBe(0);
  });

  it('clamps minutes into a single day', () => {
    expect(clampMinute(-10)).toBe(0);
    expect(clampMinute(5000)).toBe(1439);
    expect(clampMinute(330)).toBe(330);
  });
});
