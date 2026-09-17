import { clampScale } from './geometry';

/**
 * The arithmetic of zooming the calendar. Pure: no React, no DOM, no clock —
 * the same split `nextPosition` makes in useBlockDrag, and the only reason a
 * gesture can be tested on a machine with no browser.
 *
 * `documentMinute` is minutes from the top of the mounted strip: the day's
 * index in the window times MINUTES_PER_DAY, plus the minute within the day.
 * At the default scale it is also the pixel, which is what makes these
 * readable.
 */

/**
 * One press of `+` or `-`. Additive rather than multiplicative so every scale
 * on the ladder is a round number — 30, 40 … 140 — and both limits are whole
 * steps, so no press is ever clipped short.
 */
export const ZOOM_STEP_PIXELS_PER_HOUR = 10;

export function steppedScale(pixelsPerHour: number, steps: number): number {
  return clampScale(pixelsPerHour + steps * ZOOM_STEP_PIXELS_PER_HOUR);
}

/** Which minute of the strip sits `focalOffset` pixels below the viewport's top edge. */
export function documentMinuteAt(
  scrollTop: number,
  focalOffset: number,
  pixelsPerHour: number,
): number {
  return ((scrollTop + focalOffset) / pixelsPerHour) * 60;
}

/**
 * The scrollTop that puts `documentMinute` back at `focalOffset`. The exact
 * inverse of `documentMinuteAt`, and that is the whole trick: read the instant
 * under the gesture before the scale changes, put it back after.
 */
export function scrollTopForScale(
  documentMinute: number,
  pixelsPerHour: number,
  focalOffset: number,
): number {
  return (documentMinute / 60) * pixelsPerHour - focalOffset;
}
