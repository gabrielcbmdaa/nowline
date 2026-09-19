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

/**
 * What a wheel notch is worth. Chrome sends deltaY 100 for one notch, so a
 * notch is one keyboard step; a trackpad sends many small deltas and moves
 * proportionally little, which is the behaviour a trackpad should have.
 */
const PIXELS_PER_HOUR_PER_WHEEL_PIXEL = ZOOM_STEP_PIXELS_PER_HOUR / 100;

/** `deltaPixels` must already be normalised out of deltaMode by the caller. */
export function wheelScale(pixelsPerHour: number, deltaPixels: number): number {
  // Wheel down is positive deltaY, and zooms out: the direction of every map.
  return clampScale(pixelsPerHour - deltaPixels * PIXELS_PER_HOUR_PER_WHEEL_PIXEL);
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

/** What the gesture recorded when it started, and what a limit re-anchors. */
export type PinchAnchor = { pixelsPerHour: number; span: number };

/**
 * The scale the fingers are asking for, and the anchor to keep asking against.
 *
 * The anchor comes back out, rather than only going in, because of the limits:
 * when the scale clamps, the anchor clamps with it. Without that, spreading the
 * fingers past the ceiling banks scale nobody can see, and the pinch has to
 * travel all the way back before the screen moves again. AOSP's DayView does
 * the same thing in onScale, for the same reason.
 */
export function applyPinch(
  anchor: PinchAnchor,
  span: number,
): { pixelsPerHour: number; anchor: PinchAnchor } {
  // A span of nothing is two fingers in the same place: no ratio to be had.
  if (anchor.span <= 0 || span <= 0) {
    return { pixelsPerHour: anchor.pixelsPerHour, anchor };
  }
  const asked = anchor.pixelsPerHour * (span / anchor.span);
  const pixelsPerHour = clampScale(asked);
  if (pixelsPerHour !== asked) {
    return { pixelsPerHour, anchor: { pixelsPerHour, span } };
  }
  return { pixelsPerHour, anchor };
}
