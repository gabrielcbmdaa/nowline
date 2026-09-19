import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { addDays } from '../../domain/dates';
import { clampScale, dayHeight, minuteToPixel } from '../../domain/geometry';
import { applyPinch, documentMinuteAt, scrollTopForScale, type PinchAnchor } from '../../domain/zoom';
import { abortGestures, setVisibleDate as publishVisibleDate, setZoom } from '../../state/store';

function spanOf(pointers: Map<number, number>): number {
  const [first, second] = [...pointers.values()];
  return Math.abs(first - second);
}

function midpointOf(pointers: Map<number, number>): number {
  const [first, second] = [...pointers.values()];
  return (first + second) / 2;
}

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

  /** The two pointers of a pinch, by id, and what the gesture is anchored to. */
  const pinchPointers = useRef(new Map<number, number>());
  const pinchAnchor = useRef<PinchAnchor | null>(null);
  /**
   * While a pinch is live the strip holds still: one thing changes the geometry
   * at a time. Two would leave relativeAdjust compensating with one scale for
   * content laid out at another, which jumps the strip a whole day.
   */
  const zooming = useRef(false);

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
    // A viewport of 0px cannot tell a window edge from the top of the strip —
    // jsdom is the standing case; a hidden calendar would be another.
    if (!element || adjusting.current || element.clientHeight === 0) return;
    // The strip does not shift while the scale is moving; the check runs once
    // more when the fingers come up, with the scale already settled.
    if (zooming.current) return;

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

  // Bound in the capture phase on .calendar__scroll — see CalendarScreen.tsx.
  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const pointers = pinchPointers.current;
    pointers.set(event.pointerId, event.clientY);
    if (pointers.size !== 2) return;
    // Before the first frame of the pinch: no drag may outlive the scale that
    // measured its pixels.
    abortGestures();
    zooming.current = true;
    pinchAnchor.current = {
      pixelsPerHour: pixelsPerHourRef.current,
      span: spanOf(pointers),
    };
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const pointers = pinchPointers.current;
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, event.clientY);
      const anchor = pinchAnchor.current;
      const element = scrollRef.current;
      if (!anchor || pointers.size !== 2 || !element) return;

      const next = applyPinch(anchor, spanOf(pointers));
      pinchAnchor.current = next.anchor;
      const bounds = element.getBoundingClientRect();
      // The focal point of this gesture: the middle of the two fingers.
      const focalOffset = midpointOf(pointers) - bounds.top;
      zoomTo(next.pixelsPerHour, focalOffset);
    },
    [zoomTo],
  );

  const endPinch = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const pointers = pinchPointers.current;
    if (!pointers.delete(event.pointerId)) return;
    if (pointers.size >= 2) return;
    pinchAnchor.current = null;
    const wasZooming = zooming.current;
    zooming.current = false;
    // Native scroll was swallowed while zooming, and setting scrollTop in the
    // layout effect sets `adjusting`, so the strip never heard this gesture
    // end. Run the check now, at the settled scale, and only if a pinch
    // actually ran — every pointerup on the scroller reaches here.
    if (wasZooming) onScroll();
  }, [onScroll]);

  return {
    days,
    visibleDate,
    scrollRef,
    onScroll,
    goTo,
    zoomTo,
    onPointerDown,
    onPointerMove,
    onPointerUp: endPinch,
    onPointerCancel: endPinch,
  };
}
