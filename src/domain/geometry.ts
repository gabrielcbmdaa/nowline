/**
 * The single source of truth for the calendar scale.
 * Turning this constant into a state value is all a future pinch-to-zoom
 * needs: every position in the app is derived from it.
 */
export const PIXELS_PER_HOUR = 64;

export const MINUTES_PER_DAY = 24 * 60;

export const DAY_HEIGHT = PIXELS_PER_HOUR * 24;

/** Touch interactions round to this grid; the stopwatch never does. */
export const SNAP_MINUTES = 15;

export function minuteToPixel(minute: number): number {
  return (minute / 60) * PIXELS_PER_HOUR;
}

export function pixelToMinute(pixel: number): number {
  return (pixel / PIXELS_PER_HOUR) * 60;
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
