// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockPlan } from '../domain/types';
import { LocalStorageRepository } from './localStorageRepository';
import { firstSyncDecision, inspectFirstSync, settleFirstSync, syncOnce } from './sync';

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

describe('firstSyncDecision', () => {
  it('uploads when the cloud is empty', () => {
    expect(firstSyncDecision(34, 0)).toBe('upload-mine');
  });

  it('downloads when this device is empty', () => {
    expect(firstSyncDecision(0, 120)).toBe('take-the-cloud');
  });

  it('asks when both sides have rows', () => {
    // Ids are made per device, so merging does not lose data — it makes
    // duplicates, and those get cleaned up by hand.
    expect(firstSyncDecision(34, 120)).toBe('ask-the-owner');
  });

  it('uploads when neither side has anything, rather than asking about nothing', () => {
    expect(firstSyncDecision(0, 0)).toBe('upload-mine');
  });
});

describe('inspectFirstSync', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('asks when both sides hold rows, and changes nothing', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: false });
    await repo.savePlan({ ...plan, id: 'mine' });

    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1',
      changes: { projects: [], plans: [{ ...plan, id: 'theirs' }], overrides: [] },
      rejected: [],
    });

    const look = await inspectFirstSync({ send, repo });

    expect(look).toEqual({ kind: 'ask', local: 1, remote: 1 });
    // Looking is not merging: nothing downloaded may be written, and nothing
    // local may be sent, until the owner has chosen.
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['mine']);
    expect(send.mock.calls[0][2]).toEqual({ projects: [], plans: [], overrides: [] });
  });

  it('settles by itself when the cloud is empty', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: false });
    await repo.savePlan({ ...plan, id: 'mine' });

    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1',
      changes: { projects: [], plans: [], overrides: [] },
      rejected: [],
    });

    expect(await inspectFirstSync({ send, repo })).toEqual({ kind: 'settled', choice: 'upload-mine' });
  });

  it('passes a network failure through instead of guessing', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: false });
    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'offline', status: null });

    // Guessing "the cloud is empty" from silence is how a device uploads over
    // a full account.
    expect(await inspectFirstSync({ send, repo })).toEqual({ kind: 'offline' });
  });
});

describe('settleFirstSync', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uploads everything this device holds when the owner keeps his own', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: false });
    await repo.savePlan({ ...plan, id: 'mine' });
    await repo.clearPending({ projects: [], plans: ['mine'], overrides: [] });

    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1', changes: { projects: [], plans: [], overrides: [] }, rejected: [],
    });

    await settleFirstSync('upload-mine', { send, repo });

    // Not just what is queued: a device joining for the first time owes the
    // server everything it has, including rows saved before any queue existed.
    expect(send.mock.calls[0][2].plans.map((row: { id: string }) => row.id)).toEqual(['mine']);
    expect((await repo.readSyncState()).joined).toBe(true);
  });

  it('keeps a copy of the local rows before taking the cloud', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: false });
    await repo.savePlan({ ...plan, id: 'mine' });

    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1',
      changes: { projects: [], plans: [{ ...plan, id: 'theirs' }], overrides: [] },
      rejected: [],
    });

    await settleFirstSync('take-the-cloud', { send, repo, today: () => '2026-09-09' });

    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['theirs']);
    // Nothing in this app destroys the owner's data on one choice: his real
    // data lives on a phone, with no console to dig it back out of.
    const kept = JSON.parse(localStorage.getItem('nowline.discarded.2026-09-09') ?? 'null');
    expect(kept.plans.map((row: { id: string }) => row.id)).toEqual(['mine']);
    expect((await repo.listPending()).plans).toEqual([]);
  });

  it('does not mark the device joined when the round failed', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: false });
    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'offline', status: null });

    await settleFirstSync('upload-mine', { send, repo });

    // Marking it joined here would let the next timer round merge blind, which
    // is the exact thing this pair of tasks exists to prevent.
    expect((await repo.readSyncState()).joined).toBe(false);
  });

  it('refuses to act on "ask the owner", which is not a decision', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: false });
    await repo.savePlan({ ...plan, id: 'mine' });
    const send = vi.fn();

    expect(await settleFirstSync('ask-the-owner', { send, repo })).toEqual({ kind: 'undecided' });
    expect(send).not.toHaveBeenCalled();
    expect((await repo.readSyncState()).joined).toBe(false);
  });

  it('does not put back a token the server has just rejected', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'stale', cursor: 'T1', joined: false });
    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'unauthorized', status: 401 });

    await settleFirstSync('upload-mine', { send, repo });

    const state = await repo.readSyncState();
    // The round already decided this key is dead. Restoring it means every
    // later round spends a request being told so again.
    expect(state.token).toBeNull();
    // And the question is still unanswered, so the engine must stay shut.
    expect(state.joined).toBe(false);
  });
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

  it('refuses to sync until the first-sync question has been settled', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: false });
    const send = vi.fn();

    const outcome = await syncOnce({ send, repo });

    // Section 9 of the design: with rows on both sides the device stops and
    // asks, once. A round fired by a timer must not answer that question.
    expect(send).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'needs-first-sync' });
  });

  it('syncs normally once it has been settled', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: true });
    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1',
      changes: { projects: [], plans: [], overrides: [] },
      rejected: [],
    });

    const outcome = await syncOnce({ send, repo });

    expect(send).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: 'done', downloaded: 0, stillOwed: 0 });
  });

  it('sends what is owed and remembers the cursor it was handed', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: true });
    await repo.savePlan({ ...plan, id: 'p1' });

    const send = vi.fn().mockResolvedValue(emptyReply('2026-09-09T20:00:00.000Z'));
    await syncOnce({ send, repo });

    expect(send.mock.calls[0][2].plans.map((row: { id: string }) => row.id)).toEqual(['p1']);
    expect((await repo.readSyncState()).cursor).toBe('2026-09-09T20:00:00.000Z');
    expect((await repo.listPending()).plans).toEqual([]);
  });

  it('keeps the cursor it had when the network is down', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: 'T1', joined: true });

    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'offline', status: null });
    const outcome = await syncOnce({ send, repo });

    expect(outcome).toEqual({ kind: 'offline' });
    // Moving the cursor on a failed round would skip everything written since.
    expect((await repo.readSyncState()).cursor).toBe('T1');
  });

  it('keeps a rejected row in the queue', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: true });
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
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: true });

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
    await repo.writeSyncState({ token: 'stale', cursor: 'T1', joined: true });

    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'unauthorized', status: 401 });
    await syncOnce({ send, repo });

    // Keeping it means every later round spends a request proving it is dead.
    // The cursor stays: the rows already downloaded are still downloaded.
    expect(await repo.readSyncState()).toEqual({ token: null, cursor: 'T1', joined: true });
  });

  it('confirms against the stamps it sent, not the ones it finds afterwards', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', cursor: null, joined: true });
    await repo.savePlan({ ...plan, id: 'p1', title: 'version A' });

    // The edit lands while the request is in the air, which is the only moment
    // this ordering matters.
    const send = vi.fn().mockImplementation(async () => {
      await repo.savePlan({ ...plan, id: 'p1', title: 'version B' });
      return { serverTime: 'T1', changes: { projects: [], plans: [], overrides: [] }, rejected: [] };
    });

    await syncOnce({ send, repo });

    expect((await repo.listPending()).plans).toEqual(['p1']);
  });
});
