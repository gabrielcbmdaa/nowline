import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PIXELS_PER_HOUR,
  MAX_PIXELS_PER_HOUR,
  MIN_PIXELS_PER_HOUR,
} from './geometry';
import {
  ZOOM_STEP_PIXELS_PER_HOUR,
  documentMinuteAt,
  scrollTopForScale,
  steppedScale,
  wheelScale,
} from './zoom';

describe('steppedScale', () => {
  it('moves one whole step per press', () => {
    expect(steppedScale(DEFAULT_PIXELS_PER_HOUR, 1)).toBe(70);
    expect(steppedScale(DEFAULT_PIXELS_PER_HOUR, -1)).toBe(50);
  });

  it('lands exactly on both limits, so no press is ever a short one', () => {
    // Three presses down from 60, eight up: the ladder is 30, 40 … 140.
    expect(steppedScale(DEFAULT_PIXELS_PER_HOUR, -3)).toBe(MIN_PIXELS_PER_HOUR);
    expect(steppedScale(DEFAULT_PIXELS_PER_HOUR, 8)).toBe(MAX_PIXELS_PER_HOUR);
    expect(ZOOM_STEP_PIXELS_PER_HOUR).toBe(10);
  });

  it('stops at the limits instead of running past them', () => {
    expect(steppedScale(MIN_PIXELS_PER_HOUR, -1)).toBe(MIN_PIXELS_PER_HOUR);
    expect(steppedScale(MAX_PIXELS_PER_HOUR, 1)).toBe(MAX_PIXELS_PER_HOUR);
  });
});

describe('the instant under the focal point does not move', () => {
  it('reads the minute of the strip under a point of the viewport', () => {
    // At one pixel a minute, scrollTop 1000 with the focus 200px down the
    // viewport is minute 1200 of the strip: day 0 at 20:00.
    expect(documentMinuteAt(1000, 200, DEFAULT_PIXELS_PER_HOUR)).toBe(1200);
    // At half the scale the same 1200 pixels are twice the minutes.
    expect(documentMinuteAt(1000, 200, MIN_PIXELS_PER_HOUR)).toBe(2400);
  });

  it('is the exact inverse of the scrollTop that restores it', () => {
    for (const scale of [MIN_PIXELS_PER_HOUR, DEFAULT_PIXELS_PER_HOUR, 97, MAX_PIXELS_PER_HOUR]) {
      for (const scrollTop of [0, 137, 4021]) {
        for (const offset of [0, 200, 733]) {
          const minute = documentMinuteAt(scrollTop, offset, scale);
          expect(scrollTopForScale(minute, scale, offset)).toBeCloseTo(scrollTop, 10);
        }
      }
    }
  });

  it('keeps that instant in place across a change of scale', () => {
    // Looking at minute 1200 of the strip, 200px down the viewport, at 60.
    const minute = documentMinuteAt(1000, 200, DEFAULT_PIXELS_PER_HOUR);
    // Zoom in to 120: the same instant is now at pixel 2400, so the top of the
    // viewport has to sit at 2200 for it to stay 200px down.
    expect(scrollTopForScale(minute, 120, 200)).toBe(2200);
    // And back out to 30: pixel 600, so scrollTop 400.
    expect(scrollTopForScale(minute, MIN_PIXELS_PER_HOUR, 200)).toBe(400);
  });
});

describe('wheelScale', () => {
  it('makes one mouse notch worth one keyboard step', () => {
    // Chrome sends deltaY 100 per notch. Up (negative) zooms in.
    expect(wheelScale(DEFAULT_PIXELS_PER_HOUR, -100)).toBe(70);
    expect(wheelScale(DEFAULT_PIXELS_PER_HOUR, 100)).toBe(50);
  });

  it('scales with the delta, so a trackpad moves a little at a time', () => {
    expect(wheelScale(DEFAULT_PIXELS_PER_HOUR, -10)).toBe(61);
    expect(wheelScale(DEFAULT_PIXELS_PER_HOUR, 5)).toBe(59.5);
  });

  it('stops at the limits', () => {
    expect(wheelScale(DEFAULT_PIXELS_PER_HOUR, -10000)).toBe(MAX_PIXELS_PER_HOUR);
    expect(wheelScale(DEFAULT_PIXELS_PER_HOUR, 10000)).toBe(MIN_PIXELS_PER_HOUR);
  });
});
