import {
  clampScale,
  DEFAULT_PIXELS_PER_HOUR,
  MAX_PIXELS_PER_HOUR,
  MIN_PIXELS_PER_HOUR,
} from '../domain/geometry';
import { reportWarning } from '../reportError';

/**
 * This device's own preferences, and the second — and only other — file in the
 * app allowed to say `localStorage`.
 *
 * Why not a method on BlockRepository: that interface exists so a server
 * implementation can replace it without touching a call site, and the hour
 * scale must never leave this device — the zoom you want on a phone is not the
 * one you want on a laptop. Putting it there would make every implementation,
 * including the server's, answer a question that is not its own. Synchronous
 * for the same reason: there is no seam to keep open here.
 */

const ZOOM_KEY = 'nowline.zoom.v1';

/**
 * The stored scale, or the default. Anything that is not a number inside the
 * range the calendar allows is treated as absent and reported: a preference is
 * a convenience, and a damaged one must not keep the calendar from opening.
 */
export function readZoom(): number {
  const raw = localStorage.getItem(ZOOM_KEY);
  if (raw === null) return DEFAULT_PIXELS_PER_HOUR;

  const value = Number(raw);
  if (
    !Number.isFinite(value) ||
    value < MIN_PIXELS_PER_HOUR ||
    value > MAX_PIXELS_PER_HOUR
  ) {
    // Left in place, not removed: nothing is lost by keeping it, and the next
    // write overwrites it anyway.
    reportWarning(`${ZOOM_KEY} holds no usable scale; using the default`, raw);
    return DEFAULT_PIXELS_PER_HOUR;
  }
  return value;
}

/** Clamped here too, so the key can never come to hold an impossible scale. */
export function writeZoom(pixelsPerHour: number): void {
  try {
    localStorage.setItem(ZOOM_KEY, String(clampScale(pixelsPerHour)));
  } catch (error: unknown) {
    // A full quota must not break zooming; the scale simply will not survive
    // the reload.
    reportWarning(`${ZOOM_KEY} could not be written`, error);
  }
}
