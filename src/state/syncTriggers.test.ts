// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../storage/sync', () => ({ syncOnce: vi.fn() }));

import { syncOnce } from '../storage/sync';
import { repository } from '../storage/repository';
import type { BlockOverride } from '../domain/types';
import { getState, loadAll, savePlan, startSyncing, syncNow } from './store';

const round = syncOnce as Mock;

const runningOverride: BlockOverride = {
  id: 'base',
  planId: 'p1',
  date: '2026-09-03',
  status: 'running',
  actualStart: null,
  actualEnd: null,
  startMinute: null,
  durationMinutes: null,
  updatedAt: '2026-09-03T00:00:00.000Z',
};

const plan = {
  id: 'p1',
  title: 'Make exercise',
  projectId: null,
  startMinute: 300,
  durationMinutes: 120,
  recurrence: { type: 'daily' as const },
  anchorDate: '2026-09-03',
  endDate: null,
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
  deletedAt: null,
};

describe('the four moments a round happens', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.useRealTimers();
    round.mockReset();
    round.mockResolvedValue({ kind: 'done', downloaded: 0, stillOwed: 0 });
    await loadAll();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops the losing timer when a round brings a second running one down', async () => {
    // Phone and laptop both started one while offline. Section 10: the newest
    // actualStart wins and the others stop at that instant. Two devices is the
    // scenario the whole design exists for, not an edge case.
    await repository.applyFromServer({
      projects: [],
      plans: [],
      overrides: [
        { ...runningOverride, id: 'from-the-phone', actualStart: '2026-09-09T09:00:00.000Z' },
        { ...runningOverride, id: 'from-the-laptop', actualStart: '2026-09-09T10:00:00.000Z' },
      ],
    });
    round.mockResolvedValue({ kind: 'done', downloaded: 2, stillOwed: 0 });

    await syncNow();

    const stored = await repository.listOverrides();
    const stillRunning = stored.filter((row) => row.status === 'running').map((row) => row.id);
    expect(stillRunning).toEqual(['from-the-laptop']);
    const loser = stored.find((row) => row.id === 'from-the-phone');
    expect(loser?.actualEnd).toBe('2026-09-09T10:00:00.000Z');

    // And the stop has to travel: this device decided it, so the other one
    // learns about it the same way it learns about anything else.
    expect((await repository.listPending()).overrides).toContain('from-the-phone');
  });

  it('re-reads storage when a round brought rows down', async () => {
    // The store must not guess what arrived: only the repository knows what the
    // merge left behind, so it reads again rather than trusting a count.
    await repository.applyFromServer({
      projects: [],
      plans: [{ ...plan, id: 'from-the-phone' }],
      overrides: [],
    });
    round.mockResolvedValue({ kind: 'done', downloaded: 1, stillOwed: 0 });

    await syncNow();

    expect(getState().plans.map((row) => row.id)).toContain('from-the-phone');
  });

  it('does not re-read when nothing came down', async () => {
    const reading = vi.spyOn(repository, 'listPlans');
    round.mockResolvedValue({ kind: 'done', downloaded: 0, stillOwed: 0 });

    await syncNow();

    // Every round would otherwise rebuild the whole screen for nothing, five
    // minutes apart, for ever.
    expect(reading).not.toHaveBeenCalled();
  });

  it('groups a burst of writes into one round', async () => {
    vi.useFakeTimers();

    // Dragging a block writes many times. One gesture is one round, not thirty
    // requests; that is what the two-second wait buys.
    await savePlan({ ...plan, startMinute: 300 });
    await savePlan({ ...plan, startMinute: 330 });
    await savePlan({ ...plan, startMinute: 360 });

    expect(round).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(round).toHaveBeenCalledTimes(1);
  });

  it('asks again five minutes later without anybody touching anything', async () => {
    vi.useFakeTimers();
    const stop = startSyncing();
    round.mockClear();

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(round).toHaveBeenCalledTimes(1);

    stop();
  });

  it('stops asking once the caller says so', async () => {
    vi.useFakeTimers();
    const stop = startSyncing();
    stop();
    round.mockClear();

    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

    // A component that unmounts and leaves an interval behind is a request
    // every five minutes for as long as the tab lives.
    expect(round).not.toHaveBeenCalled();
  });
});
