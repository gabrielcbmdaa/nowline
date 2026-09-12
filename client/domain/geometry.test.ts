import { describe, expect, it } from 'vitest';
import {
  DAY_HEIGHT,
  PIXELS_PER_HOUR,
  clampMinute,
  floorToQuarterHour,
  minuteToPixel,
  pixelToMinute,
  snapToQuarterHour,
} from './geometry';

describe('geometry', () => {
  it('places 5:30 at pixel 352', () => {
    expect(minuteToPixel(330)).toBe(352);
  });

  it('spans a full day', () => {
    expect(PIXELS_PER_HOUR).toBe(64);
    expect(DAY_HEIGHT).toBe(1536);
    expect(minuteToPixel(1440)).toBe(DAY_HEIGHT);
  });

  it('round-trips minutes through pixels', () => {
    for (const minute of [0, 1, 330, 719, 1439]) {
      expect(pixelToMinute(minuteToPixel(minute))).toBeCloseTo(minute, 10);
    }
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
