import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { addDays } from '../../domain/dates';
import { clampScale, dayHeight, minuteToPixel } from '../../domain/geometry';
import { documentMinuteAt, scrollTopForScale } from '../../domain/zoom';
import { setVisibleDate as publishVisibleDate, setZoom } from '../../state/store';

/** Days kept mounted at once; 365 would be half a million pixels tall. */
export const WINDOW_DAYS = 7;

export function buildWindow(centerDate: string): string[] {
  const half = Math.floor(WINDOW_DAYS / 2);
  return Array.from({ length: WINDOW_DAYS }, (_, index) =>
    addDays(centerDate, index - half),
  );
}

export function useInfiniteDays(initialDate: string, pixelsPerHour: number) {
  const [days, setDays] = useState(() => buildWindow(initialDate));
  const [visibleDate, setVisibleDate] = useState(initialDate);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Pixels to add to scrollTop after the window shifts. */
  const relativeAdjust = useRef(0);
  /** Absolute scrollTop requested by goTo, applied after the re-render. */
  const absoluteTarget = useRef<number | null>(null);
  /** Guards against the scroll events our own adjustments cause. */
  const adjusting = useRef(false);

  /** Read inside the scroll handler, which is created once. */
  const daysRef = useRef(days);
  const visibleDateRef = useRef(initialDate);
  /** Read inside the scroll handler, which is created once. */
  const pixelsPerHourRef = useRef(pixelsPerHour);

  useLayoutEffect(() => {
    daysRef.current = days;
    pixelsPerHourRef.current = pixelsPerHour;
    const element = scrollRef.current;
    if (!element) return;

    if (absoluteTarget.current !== null) {
      adjusting.current = true;
      element.scrollTop = absoluteTarget.current;
      absoluteTarget.current = null;
      relativeAdjust.current = 0;
      adjusting.current = false;
      return;
    }

    if (relativeAdjust.current !== 0) {
      // Prepending a day pushes everything down by exactly one day's height.
      // Without this correction in the same frame, the scroll jumps visibly.
      adjusting.current = true;
      element.scrollTop += relativeAdjust.current;
      relativeAdjust.current = 0;
      adjusting.current = false;
    }
  }, [days, pixelsPerHour]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element || adjusting.current) return;

    const height = dayHeight(pixelsPerHourRef.current);

    const distanceToBottom =
      element.scrollHeight - element.scrollTop - element.clientHeight;

    if (element.scrollTop < height) {
      setDays((previous) => [addDays(previous[0], -1), ...previous.slice(0, -1)]);
      relativeAdjust.current += height;
    } else if (distanceToBottom < height) {
      setDays((previous) => [
        ...previous.slice(1),
        addDays(previous[previous.length - 1], 1),
      ]);
      // Dropping the first day removes that height from above the viewport.
      relativeAdjust.current -= height;
    }

    // Never call a setter from inside a state updater: updaters must stay pure,
    // and React runs them twice in development.
    const index = Math.min(
      daysRef.current.length - 1,
      Math.max(0, Math.floor((element.scrollTop + 1) / height)),
    );
    const nextVisible = daysRef.current[index];
    if (nextVisible !== visibleDateRef.current) {
      visibleDateRef.current = nextVisible;
      setVisibleDate(nextVisible);
      publishVisibleDate(nextVisible);
    }
  }, []);

  const goTo = useCallback((date: string, minute: number) => {
    const element = scrollRef.current;
    const half = Math.floor(WINDOW_DAYS / 2);
    setDays(buildWindow(date));
    daysRef.current = buildWindow(date);
    visibleDateRef.current = date;
    setVisibleDate(date);
    publishVisibleDate(date);
    // Put the requested minute a third of the way down the viewport.
    absoluteTarget.current =
      half * dayHeight(pixelsPerHour) +
      minuteToPixel(minute, pixelsPerHour) -
      (element ? element.clientHeight / 3 : 0);
  }, [pixelsPerHour]);

  /**
   * Change the scale and move scrollTop so the instant at `focalOffset` pixels
   * down the viewport stays there. `null` means the gesture has no focal point
   * — a key, a button — and then the focal point is the middle of the screen.
   */
  const zoomTo = useCallback((requested: number, focalOffset: number | null) => {
    const element = scrollRef.current;
    if (!element) return;
    const current = pixelsPerHourRef.current;
    const next = clampScale(requested);
    if (next === current) return;
    const offset = focalOffset ?? element.clientHeight / 2;
    const documentMinute = documentMinuteAt(element.scrollTop, offset, current);
    setZoom(next);
    // Applied by the layout effect, which now also runs when the scale changes.
    absoluteTarget.current = Math.max(0, scrollTopForScale(documentMinute, next, offset));
  }, []);

  return { days, visibleDate, scrollRef, onScroll, goTo, zoomTo };
}
