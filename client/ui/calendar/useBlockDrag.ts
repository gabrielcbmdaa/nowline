import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { minutesSinceMidnight, wallClockMinutesBetween } from '../../domain/dates';
import { reportError } from '../../reportError';
import {
  MINUTES_PER_DAY,
  pixelToMinute,
  SNAP_MINUTES,
  snapToQuarterHour,
} from '../../domain/geometry';
import type { ResolvedOccurrence } from '../../domain/types';
import { getState, newId, saveOverride, useAppState } from '../../state/store';

export type DragMode = 'move' | 'start' | 'end';

export type Position = { startMinute: number; durationMinutes: number };

type Gesture = {
  pointerId: number;
  mode: DragMode;
  startY: number;
  origin: Position;
  current: Position;
  moved: boolean;
  /** True when the gesture began by surviving the hold. A lift then is not a tap. */
  fromHold: boolean;
};

/** Below this the gesture was a tap, not a drag. */
const TAP_SLOP_PIXELS = 5;

/** A touch must be held this long before a scheduled block will drag. Mouse does not wait. */
export const LONG_PRESS_MS = 500;

type Hold = {
  pointerId: number;
  mode: DragMode;
  startY: number;
  origin: Position;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function samePosition(a: Position, b: Position): boolean {
  return a.startMinute === b.startMinute && a.durationMinutes === b.durationMinutes;
}

/**
 * Where the block lands for a gesture of `deltaMinutes`, given where it started.
 * Pure: no React, no clock, no storage — this is the part worth testing.
 */
export function nextPosition(
  mode: DragMode,
  origin: Position,
  deltaMinutes: number,
): Position {
  if (mode === 'move') {
    // A block starts inside its day and may end after it. The last start that
    // leaves room for the shortest block is a quarter hour before midnight.
    const startMinute = clamp(
      snapToQuarterHour(origin.startMinute + deltaMinutes),
      0,
      MINUTES_PER_DAY - SNAP_MINUTES,
    );
    return { startMinute, durationMinutes: origin.durationMinutes };
  }

  if (mode === 'end') {
    const endMinute = snapToQuarterHour(
      origin.startMinute + origin.durationMinutes + deltaMinutes,
    );
    // Midnight is no longer a wall: a block that runs into the next day is drawn
    // once, by the day it starts on, overflowing its day section. What is still a
    // wall is a full turn of the clock, which is what bounds that overflow to one
    // day, and lets the calendar look one day back and no further.
    const durationMinutes = clamp(
      endMinute - origin.startMinute,
      SNAP_MINUTES,
      MINUTES_PER_DAY,
    );
    return { startMinute: origin.startMinute, durationMinutes };
  }

  const endMinute = origin.startMinute + origin.durationMinutes;
  // Two ceilings, and the lower one wins. The end may now sit past midnight, so
  // `endMinute - SNAP_MINUTES` alone would let the start follow it out of the day
  // and store a startMinute of 1440 — a block that begins on a day it says it does
  // not belong to. A block starts inside its day; only its end may leave.
  const startMinute = clamp(
    snapToQuarterHour(origin.startMinute + deltaMinutes),
    0,
    Math.max(0, Math.min(endMinute - SNAP_MINUTES, MINUTES_PER_DAY - SNAP_MINUTES)),
  );
  return {
    startMinute,
    durationMinutes: endMinute - startMinute,
  };
}

/**
 * Both ends in marks of the grid. Only scheduled blocks reach here — `begin` returns
 * early for the tracked ones — and `resolveOccurrence` builds a scheduled end in
 * marks too, so this reads back exactly the stored duration. Asking the elapsed
 * question instead read 120 for a 180-minute block on the day the clocks go back,
 * and a resize from there stored 135.
 */
function originOf(occurrence: ResolvedOccurrence): Position {
  return {
    startMinute: minutesSinceMidnight(occurrence.displayStart, occurrence.date),
    durationMinutes: wallClockMinutesBetween(
      occurrence.displayStart,
      occurrence.displayEnd,
      occurrence.date,
    ),
  };
}

export function useBlockDrag(occurrence: ResolvedOccurrence, pixelsPerHour: number, onTap: () => void) {
  const [offsetMinutes, setOffsetMinutes] = useState(0);
  const [extraMinutes, setExtraMinutes] = useState(0);
  const [armed, setArmed] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const hold = useRef<Hold | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapCandidate = useRef<number | null>(null);
  const { gestureAbort } = useAppState();
  const seenAbort = useRef(gestureAbort);

  function resetPreview() {
    setOffsetMinutes(0);
    setExtraMinutes(0);
  }

  function clearHold() {
    if (armTimer.current !== null) {
      clearTimeout(armTimer.current);
      armTimer.current = null;
    }
    hold.current = null;
    setArmed(false);
  }

  function arm() {
    const current = hold.current;
    hold.current = null;
    armTimer.current = null;
    if (current === null) return;
    gesture.current = {
      pointerId: current.pointerId,
      mode: current.mode,
      startY: current.startY,
      origin: current.origin,
      current: current.origin,
      moved: false,
      fromHold: true,
    };
    setArmed(true);
  }

  function begin(mode: DragMode, event: ReactPointerEvent<HTMLElement>) {
    tapCandidate.current = null;
    if (occurrence.status === 'done' || occurrence.status === 'running') {
      // A tracked block is drawn from its real start and end, so dragging it
      // would overwrite the live timer. Corrections go through the editor
      // and the stop button; here the pointer is only a possible tap.
      tapCandidate.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = originOf(occurrence);
    if (event.pointerType === 'touch') {
      clearHold();
      hold.current = {
        pointerId: event.pointerId,
        mode,
        startY: event.clientY,
        origin,
      };
      armTimer.current = setTimeout(arm, LONG_PRESS_MS);
      return;
    }
    gesture.current = {
      pointerId: event.pointerId,
      mode,
      startY: event.clientY,
      origin,
      current: origin,
      moved: false,
      fromHold: false,
    };
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const waiting = hold.current;
    if (waiting !== null && event.pointerId === waiting.pointerId) {
      if (Math.abs(event.clientY - waiting.startY) > TAP_SLOP_PIXELS) {
        clearHold();
      }
      return;
    }

    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;

    const deltaMinutes = pixelToMinute(event.clientY - current.startY, pixelsPerHour);
    const next = nextPosition(current.mode, current.origin, deltaMinutes);
    current.current = next;
    if (Math.abs(event.clientY - current.startY) > TAP_SLOP_PIXELS) {
      current.moved = true;
    }
    setOffsetMinutes(next.startMinute - current.origin.startMinute);
    setExtraMinutes(next.durationMinutes - current.origin.durationMinutes);
  }

  function end(event: ReactPointerEvent<HTMLElement>) {
    const waiting = hold.current;
    if (waiting !== null && event.pointerId === waiting.pointerId) {
      clearHold();
      onTap();
      return;
    }

    if (tapCandidate.current === event.pointerId) {
      tapCandidate.current = null;
      onTap();
      return;
    }

    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;

    const committed = current.current;
    const origin = current.origin;
    const mode = current.mode;
    const moved = current.moved;
    gesture.current = null;
    resetPreview();
    setArmed(false);

    if (!moved || samePosition(committed, origin)) {
      // A hold that armed and never left its slot was a grab, not a tap.
      if (!current.fromHold) onTap();
      return;
    }

    void persist(mode, committed);
  }

  function cancel(event: ReactPointerEvent<HTMLElement>) {
    if (tapCandidate.current === event.pointerId) {
      tapCandidate.current = null;
      return;
    }

    clearHold();
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;

    gesture.current = null;
    resetPreview();
  }

  /** Given up from outside: a second finger arrived and the pinch takes over. */
  function abort() {
    tapCandidate.current = null;
    clearHold();
    if (gesture.current === null) return;
    gesture.current = null;
    resetPreview();
  }

  useEffect(() => {
    // Not on mount: there is nothing to give up when the block appears.
    if (gestureAbort === seenAbort.current) return;
    seenAbort.current = gestureAbort;
    abort();
  }, [gestureAbort]);

  useEffect(() => {
    return () => {
      if (armTimer.current !== null) {
        clearTimeout(armTimer.current);
        armTimer.current = null;
      }
      hold.current = null;
    };
  }, []);

  async function persist(mode: DragMode, committed: Position): Promise<void> {
    const existing = getState().overrides.find(
      (override) =>
        override.planId === occurrence.planId && override.date === occurrence.date,
    );

    try {
      await saveOverride({
        id: existing?.id ?? newId(),
        planId: occurrence.planId,
        date: occurrence.date,
        status: existing?.status ?? 'scheduled',
        actualStart: existing?.actualStart ?? null,
        actualEnd: existing?.actualEnd ?? null,
        startMinute: mode === 'end' ? (existing?.startMinute ?? null) : committed.startMinute,
        durationMinutes:
          mode === 'move' ? (existing?.durationMinutes ?? null) : committed.durationMinutes,
        updatedAt: new Date().toISOString(),
      });
    } catch (error) {
      reportError('Saving the dragged block failed', error);
      // Preview already cleared; the occurrence still describes the old place.
    }
  }

  return {
    offsetMinutes,
    extraMinutes,
    armed,
    onBodyPointerDown: (event: ReactPointerEvent<HTMLElement>) => begin('move', event),
    onHandlePointerDown:
      (edge: 'start' | 'end') => (event: ReactPointerEvent<HTMLElement>) =>
        begin(edge, event),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: cancel,
  };
}
