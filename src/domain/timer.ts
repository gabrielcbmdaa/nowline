import type { BlockOverride } from './types';

/** A timer left running longer than this is assumed to be forgotten. */
export const RUNAWAY_TIMER_HOURS = 12;

/**
 * Only secure contexts get randomUUID, and a phone opening the dev server over
 * the network is not one. getRandomValues is always there, so fall back to
 * laying out the v4 bytes by hand rather than tying ids to the URL scheme.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 1
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
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
    updatedAt: now.toISOString(),
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
    updatedAt: now.toISOString(),
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
    updatedAt: actualEnd.toISOString(),
  };
}

export function runningHours(override: BlockOverride, now: Date): number {
  if (override.status !== 'running' || !override.actualStart) return 0;
  const startMs = new Date(override.actualStart).getTime();
  return (now.getTime() - startMs) / 3600000;
}

/**
 * Two devices out of touch can each start a timer. Converging on the same rows
 * is not the same as obeying "one timer at a time", so the rule has to be
 * written down: the newest start wins, and the others end where it began —
 * which is what startTimerFor already does on a single device. Equal starts
 * break on id, which is the same on every device; array order is not.
 *
 * Returns only the rows that changed, so the caller knows exactly what to save.
 */
export function resolveConcurrentTimers(overrides: BlockOverride[]): BlockOverride[] {
  const running = overrides.filter(
    (override) => override.status === 'running' && override.actualStart,
  );
  if (running.length < 2) return [];

  const winner = running.reduce((latest, candidate) =>
    candidate.actualStart! > latest.actualStart! ||
    (candidate.actualStart === latest.actualStart && candidate.id > latest.id)
      ? candidate
      : latest,
  );

  return running
    .filter((override) => override.id !== winner.id)
    .map((override) => stopTimer(override, new Date(winner.actualStart!)));
}
