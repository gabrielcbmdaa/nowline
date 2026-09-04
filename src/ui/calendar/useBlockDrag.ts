import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { minutesSinceMidnight } from '../../domain/dates';
import {
  MINUTES_PER_DAY,
  pixelToMinute,
  SNAP_MINUTES,
  snapToQuarterHour,
} from '../../domain/geometry';
import type { ResolvedOccurrence } from '../../domain/types';
import { getState, newId, saveOverride } from '../../state/store';

export type DragMode = 'move' | 'start' | 'end';

export type Position = { startMinute: number; durationMinutes: number };

type Gesture = {
  pointerId: number;
  mode: DragMode;
  startY: number;
  origin: Position;
  current: Position;
  moved: boolean;
};

/** Below this the gesture was a tap, not a drag. */
const TAP_SLOP_PIXELS = 5;

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
    const startMinute = clamp(
      snapToQuarterHour(origin.startMinute + deltaMinutes),
      0,
      Math.max(0, MINUTES_PER_DAY - origin.durationMinutes),
    );
    return { startMinute, durationMinutes: origin.durationMinutes };
  }

  if (mode === 'end') {
    const endMinute = snapToQuarterHour(
      origin.startMinute + origin.durationMinutes + deltaMinutes,
    );
    const remaining = MINUTES_PER_DAY - origin.startMinute;
    const durationMinutes = clamp(
      endMinute - origin.startMinute,
      Math.min(SNAP_MINUTES, remaining),
      remaining,
    );
    return { startMinute: origin.startMinute, durationMinutes };
  }

  const endMinute = origin.startMinute + origin.durationMinutes;
  const startMinute = clamp(
    snapToQuarterHour(origin.startMinute + deltaMinutes),
    0,
    Math.max(0, endMinute - SNAP_MINUTES),
  );
  return {
    startMinute,
    durationMinutes: endMinute - startMinute,
  };
}

function originOf(occurrence: ResolvedOccurrence): Position {
  return {
    startMinute: minutesSinceMidnight(occurrence.displayStart, occurrence.date),
    durationMinutes:
      (occurrence.displayEnd.getTime() - occurrence.displayStart.getTime()) / 60000,
  };
}

export function useBlockDrag(occurrence: ResolvedOccurrence, onTap: () => void) {
  const [offsetMinutes, setOffsetMinutes] = useState(0);
  const [extraMinutes, setExtraMinutes] = useState(0);
  const gesture = useRef<Gesture | null>(null);
  const tapCandidate = useRef<number | null>(null);

  function resetPreview() {
    setOffsetMinutes(0);
    setExtraMinutes(0);
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
    gesture.current = {
      pointerId: event.pointerId,
      mode,
      startY: event.clientY,
      origin,
      current: origin,
      moved: false,
    };
  }

  function move(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;

    const deltaMinutes = pixelToMinute(event.clientY - current.startY);
    const next = nextPosition(current.mode, current.origin, deltaMinutes);
    current.current = next;
    if (Math.abs(event.clientY - current.startY) > TAP_SLOP_PIXELS) {
      current.moved = true;
    }
    setOffsetMinutes(next.startMinute - current.origin.startMinute);
    setExtraMinutes(next.durationMinutes - current.origin.durationMinutes);
  }

  function end(event: ReactPointerEvent<HTMLElement>) {
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

    if (!moved || samePosition(committed, origin)) {
      onTap();
      return;
    }

    void persist(mode, committed);
  }

  function cancel(event: ReactPointerEvent<HTMLElement>) {
    if (tapCandidate.current === event.pointerId) {
      tapCandidate.current = null;
      return;
    }

    const current = gesture.current;
    if (!current || event.pointerId !== current.pointerId) return;

    gesture.current = null;
    resetPreview();
  }

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
      });
    } catch {
      // Preview already cleared; the occurrence still describes the old place.
    }
  }

  return {
    offsetMinutes,
    extraMinutes,
    onBodyPointerDown: (event: ReactPointerEvent<HTMLElement>) => begin('move', event),
    onHandlePointerDown:
      (edge: 'start' | 'end') => (event: ReactPointerEvent<HTMLElement>) =>
        begin(edge, event),
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: cancel,
  };
}
