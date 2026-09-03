import type { BlockOverride } from './types';

/** A timer left running longer than this is assumed to be forgotten. */
export const RUNAWAY_TIMER_HOURS = 12;

export function newId(): string {
  return crypto.randomUUID();
}

/**
 * Tracked time is derived, never stored. Correcting an end time therefore
 * fixes every total at once: there is no second copy of the number to
 * disagree with this one.
 */
export function trackedSeconds(override: BlockOverride): number {
  if (override.status !== 'done' || !override.actualStart || !override.actualEnd) {
    return 0;
  }
  const start = new Date(override.actualStart).getTime();
  const end = new Date(override.actualEnd).getTime();
  return Math.round((end - start) / 1000);
}

/**
 * Play. The instant is stored exactly, with seconds: the quarter-hour grid
 * is a touch affordance, not a measurement.
 */
export function startTimer(
  planId: string,
  date: string,
  now: Date,
  existing: BlockOverride | null,
): BlockOverride {
  return {
    id: existing?.id ?? newId(),
    planId,
    date,
    status: 'running',
    actualStart: now.toISOString(),
    actualEnd: null,
    startMinute: existing?.startMinute ?? null,
    durationMinutes: existing?.durationMinutes ?? null,
  };
}

export function stopTimer(override: BlockOverride, now: Date): BlockOverride {
  if (override.status !== 'running' || !override.actualStart) {
    throw new Error('Timer is not running');
  }
  const startMs = new Date(override.actualStart).getTime();
  // An end never earlier than the start keeps trackedSeconds positive.
  const endMs = Math.max(now.getTime(), startMs + 1000);
  return {
    ...override,
    status: 'done',
    actualEnd: new Date(endMs).toISOString(),
  };
}

export function correctTimes(
  override: BlockOverride,
  actualStart: Date,
  actualEnd: Date,
): BlockOverride {
  if (actualEnd.getTime() <= actualStart.getTime()) {
    throw new Error('End time must be after start time');
  }
  return {
    ...override,
    status: 'done',
    actualStart: actualStart.toISOString(),
    actualEnd: actualEnd.toISOString(),
  };
}

export function runningHours(override: BlockOverride, now: Date): number {
  if (override.status !== 'running' || !override.actualStart) return 0;
  const startMs = new Date(override.actualStart).getTime();
  return (now.getTime() - startMs) / 3600000;
}
