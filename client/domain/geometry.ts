/**
 * The calendar scale, in pixels per hour, and the conversions that depend on it.
 *
 * The scale is a parameter and never a module variable: this layer is pure, and
 * a mutable scale in here would make every answer depend on when it was asked.
 * Who holds the current value is `state/store.ts`.
 */

/**
 * One pixel to one minute: `minuteToPixel(m, DEFAULT_PIXELS_PER_HOUR)` is `m`,
 * and a day is as many pixels tall as it has minutes. Also what `0` restores.
 */
export const DEFAULT_PIXELS_PER_HOUR = 60;

/** Half a day on screen at once. Fixed, not derived from the viewport, so a test can pin it. */
export const MIN_PIXELS_PER_HOUR = 30;

/**
 * A quarter-hour block is 35px here, one more than the 34px stopwatch button,
 * so from this scale up nothing is clipped. 136 is the least that manages it;
 * 140 clears it by a pixel and is a whole keyboard step above 130, so the
 * ladder lands on both limits exactly.
 */
export const MAX_PIXELS_PER_HOUR = 140;

export const MINUTES_PER_DAY = 24 * 60;

/** Touch interactions round to this grid, at every scale; the stopwatch never does. */
export const SNAP_MINUTES = 15;

export function dayHeight(pixelsPerHour: number): number {
  return pixelsPerHour * 24;
}

export function minuteToPixel(minute: number, pixelsPerHour: number): number {
  return (minute / 60) * pixelsPerHour;
}

export function pixelToMinute(pixel: number, pixelsPerHour: number): number {
  return (pixel / pixelsPerHour) * 60;
}

export function clampScale(pixelsPerHour: number): number {
  return Math.min(Math.max(pixelsPerHour, MIN_PIXELS_PER_HOUR), MAX_PIXELS_PER_HOUR);
}

/** Used while dragging or resizing an existing block. */
export function snapToQuarterHour(minute: number): number {
  return Math.round(minute / SNAP_MINUTES) * SNAP_MINUTES;
}

/**
 * Used when tapping empty space to create a block: flooring keeps the new
 * block from starting above the finger that created it.
 */
export function floorToQuarterHour(minute: number): number {
  return Math.floor(minute / SNAP_MINUTES) * SNAP_MINUTES;
}

export function clampMinute(minute: number): number {
  return Math.min(Math.max(minute, 0), MINUTES_PER_DAY - 1);
}
