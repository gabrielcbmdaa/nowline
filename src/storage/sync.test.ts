// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockPlan } from '../domain/types';
import { LocalStorageRepository } from './localStorageRepository';
import { syncOnce } from './sync';

const plan: BlockPlan = {
  id: 'p1',
  title: 'Make exercise',
  projectId: 'health',
  startMinute: 300,
  durationMinutes: 120,
  recurrence: { type: 'daily' },
  anchorDate: '2026-09-03',
  endDate: null,
  createdAt: '2026-09-03T00:00:00.000Z',
  updatedAt: '2026-09-03T00:00:00.000Z',
  deletedAt: null,
};

const emptyReply = (serverTime: string) => ({
  serverTime,
  changes: { projects: [], plans: [], overrides: [] },
  rejected: [],
});

describe('syncOnce', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does nothing until there is a token', async () => {
    const send = vi.fn();
    const outcome = await syncOnce({ send, repo: new LocalStorageRepository() });

    expect(send).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'unauthorized' });
  });

  it('sends what is owed and remembers the cursor it was handed', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null });
    await repo.savePlan({ ...plan, id: 'p1' });

    const send = vi.fn().mockResolvedValue(emptyReply('2026-09-09T20:00:00.000Z'));
    await syncOnce({ send, repo });

    expect(send.mock.calls[0][2].plans.map((row: { id: string }) => row.id)).toEqual(['p1']);
    expect((await repo.readSyncState()).cursor).toBe('2026-09-09T20:00:00.000Z');
    expect((await repo.listPending()).plans).toEqual([]);
  });

  it('keeps the cursor it had when the network is down', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: 'T1' });

    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'offline', status: null });
    const outcome = await syncOnce({ send, repo });

    expect(outcome).toEqual({ kind: 'offline' });
    // Moving the cursor on a failed round would skip everything written since.
    expect((await repo.readSyncState()).cursor).toBe('T1');
  });

  it('keeps a rejected row in the queue', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null });
    await repo.savePlan({ ...plan, id: 'p1' });

    const send = vi.fn().mockResolvedValue({ ...emptyReply('T2'), rejected: ['p1'] });
    const outcome = await syncOnce({ send, repo });

    // The server said it did not store it. Forgetting it here is how a block
    // disappears without anything failing.
    expect((await repo.listPending()).plans).toEqual(['p1']);
    expect(outcome).toEqual({ kind: 'done', downloaded: 0, stillOwed: 1 });
  });

  it('writes down what came back', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null });

    const send = vi.fn().mockResolvedValue({
      serverTime: 'T3',
      changes: { projects: [], plans: [{ ...plan, id: 'from-the-phone' }], overrides: [] },
      rejected: [],
    });
    const outcome = await syncOnce({ send, repo });

    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['from-the-phone']);
    expect(outcome).toEqual({ kind: 'done', downloaded: 1, stillOwed: 0 });
  });

  it('forgets the token when the server stops accepting it', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'stale', cursor: 'T1' });

    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'unauthorized', status: 401 });
    await syncOnce({ send, repo });

    // Keeping it means every later round spends a request proving it is dead.
    // The cursor stays: the rows already downloaded are still downloaded.
    expect(await repo.readSyncState()).toEqual({ token: null, cursor: 'T1' });
  });
});
