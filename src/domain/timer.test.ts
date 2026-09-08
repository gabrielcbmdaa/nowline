import { describe, expect, it } from 'vitest';
import type { BlockOverride } from './types';
import {
  RUNAWAY_TIMER_HOURS,
  correctTimes,
  newId,
  resolveConcurrentTimers,
  runningHours,
  startTimer,
  stopTimer,
  trackedSeconds,
} from './timer';

function runningOverride(start: Date): BlockOverride {
  return {
    id: 'o1',
    planId: 'p1',
    date: '2026-09-03',
    status: 'running',
    actualStart: start.toISOString(),
    actualEnd: null,
    startMinute: null,
    durationMinutes: null,
    updatedAt: start.toISOString(),
  };
}

describe('timer', () => {
  it('records exact seconds, not rounded minutes', () => {
    const start = new Date(2026, 8, 3, 5, 31, 12);
    const stopped = stopTimer(runningOverride(start), new Date(2026, 8, 3, 6, 17, 40));
    expect(stopped.status).toBe('done');
    expect(trackedSeconds(stopped)).toBe(2788);
  });

  it('tracks nothing for a block that was never started', () => {
    const scheduled: BlockOverride = {
      id: 'o2',
      planId: 'p1',
      date: '2026-09-03',
      status: 'scheduled',
      actualStart: null,
      actualEnd: null,
      startMinute: 330,
      durationMinutes: 120,
      updatedAt: '2026-09-03T00:00:00.000Z',
    };
    expect(trackedSeconds(scheduled)).toBe(0);
    expect(trackedSeconds(runningOverride(new Date()))).toBe(0);
  });

  it('starts a timer at the exact instant, keeping any existing override id', () => {
    const now = new Date(2026, 8, 3, 5, 31, 12);
    const fresh = startTimer('p1', '2026-09-03', now, null);
    expect(fresh.status).toBe('running');
    expect(fresh.actualStart).toBe(now.toISOString());
    expect(fresh.actualEnd).toBeNull();
    expect(fresh.planId).toBe('p1');
    expect(fresh.date).toBe('2026-09-03');

    const existing: BlockOverride = {
      id: 'kept',
      planId: 'p1',
      date: '2026-09-03',
      status: 'scheduled',
      actualStart: null,
      actualEnd: null,
      startMinute: 300,
      durationMinutes: 120,
      updatedAt: '2026-09-03T00:00:00.000Z',
    };
    const restarted = startTimer('p1', '2026-09-03', now, existing);
    expect(restarted.id).toBe('kept');
    expect(restarted.startMinute).toBe(300);
  });

  it('refuses to stop a timer that is not running', () => {
    const scheduled: BlockOverride = {
      ...runningOverride(new Date()),
      status: 'scheduled',
      actualStart: null,
    };
    expect(() => stopTimer(scheduled, new Date())).toThrow('Timer is not running');
  });

  it('guarantees at least one second of tracked time', () => {
    const start = new Date(2026, 8, 3, 5, 0, 0);
    const stopped = stopTimer(runningOverride(start), start);
    expect(trackedSeconds(stopped)).toBe(1);
  });

  it('recomputes the total when the end time is corrected', () => {
    const start = new Date(2026, 8, 3, 5, 0, 0);
    const stopped = stopTimer(runningOverride(start), new Date(2026, 8, 3, 12, 0, 0));
    expect(trackedSeconds(stopped)).toBe(25200); // 7 hours

    const corrected = correctTimes(stopped, start, new Date(2026, 8, 3, 6, 30, 0));
    expect(trackedSeconds(corrected)).toBe(5400); // 1 h 30 min
  });

  it('rejects an end time that is not after the start', () => {
    const start = new Date(2026, 8, 3, 5, 0, 0);
    const stopped = stopTimer(runningOverride(start), new Date(2026, 8, 3, 6, 0, 0));
    expect(() => correctTimes(stopped, start, start)).toThrow(
      'End time must be after start time',
    );
  });

  it('measures how long a running timer has been going', () => {
    const start = new Date(2026, 8, 3, 5, 0, 0);
    const now = new Date(2026, 8, 3, 18, 0, 0);
    expect(runningHours(runningOverride(start), now)).toBe(13);
    expect(RUNAWAY_TIMER_HOURS).toBe(12);
  });

  it('keeps the timer that started last and closes the others where it began', () => {
    const early = { ...runningOverride(new Date(2026, 8, 3, 9, 0, 0)), id: 'early' };
    const late = { ...runningOverride(new Date(2026, 8, 3, 9, 30, 0)), id: 'late' };

    const changed = resolveConcurrentTimers([early, late]);

    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe('early');
    expect(changed[0].status).toBe('done');
    expect(changed[0].actualEnd).toBe(late.actualStart);
  });

  it('leaves a single running timer alone', () => {
    expect(resolveConcurrentTimers([runningOverride(new Date(2026, 8, 3, 9, 0, 0))])).toEqual(
      [],
    );
  });

  it('breaks a start-time tie on id so two devices pick the same winner', () => {
    const sameStart = new Date(2026, 8, 3, 9, 0, 0);
    // Smaller id first: a reduce that keeps the first equal start would pick
    // 'aaa'. The greater id must win regardless of array order.
    const smaller = { ...runningOverride(sameStart), id: 'aaa' };
    const greater = { ...runningOverride(sameStart), id: 'zzz' };

    const changed = resolveConcurrentTimers([smaller, greater]);

    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe('aaa');
    expect(changed[0].status).toBe('done');
  });

  it('records the full duration of a forgotten timer instead of capping it', () => {
    // Decision, not just behaviour: a timer left running for however long
    // records all of that time — it is not capped and not zeroed.
    // Fourteen hours is above RUNAWAY_TIMER_HOURS (12) on purpose: a cap at
    // the runaway threshold, at a smaller figure, or zeroing must all go red.
    const forgotten = { ...runningOverride(new Date(2026, 8, 3, 0, 0, 0)), id: 'forgotten' };
    const winner = { ...runningOverride(new Date(2026, 8, 3, 14, 0, 0)), id: 'winner' };

    const changed = resolveConcurrentTimers([forgotten, winner]);

    expect(changed).toHaveLength(1);
    expect(changed[0].id).toBe('forgotten');
    expect(trackedSeconds(changed[0])).toBe(50400);
  });
});

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * A page served over plain http from anything but localhost is not a secure
 * context, and the browser withholds crypto.randomUUID there. getRandomValues
 * stays available, so ids must keep working without the wrapper.
 */
describe('newId without a secure context', () => {
  /**
   * randomUUID lives on Crypto.prototype, so deleting it off the instance does
   * nothing. Shadow it with undefined instead, which is what the browser shows.
   */
  function withoutRandomUUID<T>(body: () => T): T {
    const own = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');
    Object.defineProperty(crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });
    try {
      return body();
    } finally {
      if (own) Object.defineProperty(crypto, 'randomUUID', own);
      else Reflect.deleteProperty(crypto, 'randomUUID');
    }
  }

  it('still returns a valid v4 uuid', () => {
    withoutRandomUUID(() => {
      expect(crypto.randomUUID).toBeUndefined();
      expect(newId()).toMatch(UUID_V4);
    });
  });

  it('does not repeat ids', () => {
    withoutRandomUUID(() => {
      const ids = new Set(Array.from({ length: 500 }, newId));
      expect(ids.size).toBe(500);
    });
  });
});
