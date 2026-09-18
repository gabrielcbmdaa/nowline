// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { BlockPlan } from '../domain/types';

vi.mock('../reportError', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

import { reportError } from '../reportError';
import { LocalStorageRepository } from './localStorageRepository';
import { adoptSession, firstSyncDecision, inspectFirstSync, settleFirstSync, signOut, syncOnce } from './sync';

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

const reported = reportError as Mock;

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
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
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
    // Looking must not answer the question for the owner: a `joined: true`
    // written here would let the next wakeup merge before he chose.
    expect(await repo.readSyncState()).toEqual({ token: 'abc', userId: null, cursor: null, joined: false });
  });

  it('settles by itself when the cloud is empty', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
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
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'offline', status: null });

    // Guessing "the cloud is empty" from silence is how a device uploads over
    // a full account.
    expect(await inspectFirstSync({ send, repo })).toEqual({ kind: 'offline' });
  });

  it('does not ask again once the question has been answered', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: 'T1', joined: true });
    await repo.savePlan({ ...plan, id: 'mine' });
    const send = vi.fn();

    // The screen must not be given a reason to offer "take the cloud" again:
    // that button replaces everything written since the device joined.
    expect(await inspectFirstSync({ send, repo })).toEqual({ kind: 'already-joined' });
    expect(send).not.toHaveBeenCalled();
  });

  it('does not wait behind a round when the device already joined', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: 'T1', joined: true });
    let releaseSend: () => void = () => {};
    const send = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSend = () => resolve(emptyReply('T2'));
        }),
    );

    const round = syncOnce({ send, repo });

    const outcome = await Promise.race([
      inspectFirstSync({ send, repo }).then((result) => ({ kind: 'resolved' as const, result })),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        setTimeout(() => resolve({ kind: 'timeout' }), 100);
      }),
    ]);

    expect(outcome).toEqual({
      kind: 'resolved',
      result: { kind: 'already-joined' },
    });

    await vi.waitFor(() => expect(send).toHaveBeenCalled());
    releaseSend();
    await round;
  });
});

describe('settleFirstSync', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uploads everything this device holds when the owner keeps his own', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
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
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
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
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'offline', status: null });

    await settleFirstSync('upload-mine', { send, repo });

    // Marking it joined here would let the next timer round merge blind, which
    // is the exact thing this pair of tasks exists to prevent.
    expect((await repo.readSyncState()).joined).toBe(false);
  });

  it('does not claim the device joined until the round has gone through', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });

    let seenDuringTheRound: boolean | null = null;
    const send = vi.fn().mockImplementation(async () => {
      seenDuringTheRound = (await repo.readSyncState()).joined;
      return { serverTime: 'T1', changes: { projects: [], plans: [{ ...plan, id: 'theirs' }], overrides: [] }, rejected: [] };
    });

    await settleFirstSync('upload-mine', { send, repo });

    // A flag that says "answered" while the answer is still in the air is a
    // flag that lies to whoever reads it in that window.
    expect(seenDuringTheRound).toBe(false);
    expect((await repo.readSyncState()).joined).toBe(true);
  });

  it('leaves the flag alone when the settling round fails', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
    let seenDuringTheRound: boolean | null = null;
    const send = vi.fn().mockImplementation(async () => {
      seenDuringTheRound = (await repo.readSyncState()).joined;
      return { failed: true, kind: 'offline', status: null };
    });

    // Nothing to revert, because nothing was claimed. Looking only at the end
    // would pass just as happily for a flag raised and then put back, which is
    // the shape this task removed.
    expect(await settleFirstSync('upload-mine', { send, repo })).toEqual({ kind: 'offline' });
    expect(seenDuringTheRound).toBe(false);
    expect((await repo.readSyncState()).joined).toBe(false);
  });

  it('refuses to act on "ask the owner", which is not a decision', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
    await repo.savePlan({ ...plan, id: 'mine' });
    const send = vi.fn();

    expect(await settleFirstSync('ask-the-owner', { send, repo })).toEqual({ kind: 'undecided' });
    expect(send).not.toHaveBeenCalled();
    expect((await repo.readSyncState()).joined).toBe(false);
  });

  it('does not put back a token the server has just rejected', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'stale', userId: null, cursor: 'T1', joined: false });
    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'unauthorized', status: 401 });

    await settleFirstSync('upload-mine', { send, repo });

    const state = await repo.readSyncState();
    // The round already decided this key is dead. Restoring it means every
    // later round spends a request being told so again.
    expect(state.token).toBeNull();
    // And the question is still unanswered, so the engine must stay shut.
    expect(state.joined).toBe(false);
  });

  it('refuses to take a cloud that holds nothing', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
    await repo.savePlan({ ...plan, id: 'mine' });
    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1', changes: { projects: [], plans: [], overrides: [] }, rejected: [],
    });

    const outcome = await settleFirstSync('take-the-cloud', { send, repo });

    // "Take the cloud" against an empty cloud is "throw mine away and get
    // nothing". Whatever the owner meant, it was not that.
    expect(outcome).toEqual({ kind: 'undecided' });
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['mine']);
    expect((await repo.readSyncState()).joined).toBe(false);
  });

  it('says how many rows taking the cloud brought down', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
    await repo.savePlan({ ...plan, id: 'mine' });
    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1',
      changes: { projects: [], plans: [{ ...plan, id: 'theirs' }, { ...plan, id: 'also-theirs' }], overrides: [] },
      rejected: [],
    });

    // Reporting zero is what makes the caller skip reloading the screen and
    // skip settling two timers that arrived running.
    expect(await settleFirstSync('take-the-cloud', { send, repo })).toEqual({
      kind: 'done', downloaded: 2, stillOwed: 0,
    });
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
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
    const send = vi.fn();

    const outcome = await syncOnce({ send, repo });

    // Section 9 of the design: with rows on both sides the device stops and
    // asks, once. A round fired by a timer must not answer that question.
    expect(send).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'needs-first-sync' });
  });

  it('syncs normally once it has been settled', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: true });
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
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: true });
    await repo.savePlan({ ...plan, id: 'p1' });

    const send = vi.fn().mockResolvedValue(emptyReply('2026-09-09T20:00:00.000Z'));
    await syncOnce({ send, repo });

    expect(send.mock.calls[0][2].plans.map((row: { id: string }) => row.id)).toEqual(['p1']);
    expect((await repo.readSyncState()).cursor).toBe('2026-09-09T20:00:00.000Z');
    expect((await repo.listPending()).plans).toEqual([]);
  });

  it('keeps the cursor it had when the network is down', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: 'T1', joined: true });

    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'offline', status: null });
    const outcome = await syncOnce({ send, repo });

    expect(outcome).toEqual({ kind: 'offline' });
    // Moving the cursor on a failed round would skip everything written since.
    expect((await repo.readSyncState()).cursor).toBe('T1');
  });

  it('keeps a rejected row in the queue', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: true });
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
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: true });

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
    await repo.writeSyncState({ token: 'stale', userId: null, cursor: 'T1', joined: true });

    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'unauthorized', status: 401 });
    await syncOnce({ send, repo });

    // Keeping it means every later round spends a request proving it is dead.
    // The cursor stays: the rows already downloaded are still downloaded.
    expect(await repo.readSyncState()).toEqual({ token: null, userId: null, cursor: 'T1', joined: true });
  });

  it('confirms against the stamps it sent, not the ones it finds afterwards', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: true });
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

describe('engine door', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not let a look run while a round is still going', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });

    const order: string[] = [];
    let releaseSettle: (value: unknown) => void = () => {};
    const send = vi.fn().mockImplementationOnce(async () => {
      order.push('settle started');
      await new Promise((resolve) => {
        releaseSettle = resolve;
      });
      order.push('settle finished');
      return { serverTime: 'T1', changes: { projects: [], plans: [], overrides: [] }, rejected: [] };
    });

    const settle = settleFirstSync('upload-mine', { send, repo });
    const look = inspectFirstSync({ send, repo }).then((result) => {
      order.push('look done');
      return result;
    });

    // Wait for the settle to be inside `send`, not for ten milliseconds to pass:
    // a sleep proves the look was slower, not that it was held.
    await vi.waitFor(() => expect(order).toEqual(['settle started']));
    await Promise.resolve();
    expect(order).toEqual(['settle started']);

    releaseSettle(undefined);
    const [, lookResult] = await Promise.all([settle, look]);
    expect(order).toEqual(['settle started', 'settle finished', 'look done']);
    expect(lookResult).toEqual({ kind: 'already-joined' });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('makes a settle wait for a round that is already going', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: true });

    const order: string[] = [];
    let releaseRound: (value: unknown) => void = () => {};
    const send = vi
      .fn()
      .mockImplementationOnce(async () => {
        order.push('round');
        await new Promise((resolve) => {
          releaseRound = resolve;
        });
        return { serverTime: 'T1', changes: { projects: [], plans: [], overrides: [] }, rejected: [] };
      })
      .mockImplementationOnce(async () => {
        order.push('settle');
        return { serverTime: 'T2', changes: { projects: [], plans: [], overrides: [] }, rejected: [] };
      });

    const round = syncOnce({ send, repo });
    const settle = settleFirstSync('upload-mine', { send, repo });
    await vi.waitFor(() => expect(order).toEqual(['round']));
    await Promise.resolve();
    expect(order).toEqual(['round']);

    releaseRound(undefined);
    await Promise.all([round, settle]);
    expect(order).toEqual(['round', 'settle']);
  });

  it('opens the door again after an operation throws', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: true });

    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('something inside the round exploded'))
      .mockResolvedValueOnce({
        serverTime: 'T1', changes: { projects: [], plans: [], overrides: [] }, rejected: [],
      });

    // A failure that shuts the door for good is worse than the failure: the app
    // goes quiet and nothing says why.
    await expect(syncOnce({ send, repo })).rejects.toThrow('something inside the round exploded');
    expect(await syncOnce({ send, repo })).toEqual({ kind: 'done', downloaded: 0, stillOwed: 0 });
  });

  it('lets a settle finish even though it runs a round inside itself', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1', changes: { projects: [], plans: [], overrides: [] }, rejected: [],
    });

    // The one that would deadlock if the inner round waited for the outer
    // settle to release the same lock.
    const outcome = await settleFirstSync('upload-mine', { send, repo });

    expect(outcome).toEqual({ kind: 'done', downloaded: 0, stillOwed: 0 });
  });

  it('holds the door across the whole body, not only the network call', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });

    const order: string[] = [];
    let release: (value: unknown) => void = () => {};
    const slow = vi.fn().mockImplementationOnce(async () => {
      order.push('settle: send');
      await new Promise((resolve) => {
        release = resolve;
      });
      return { serverTime: 'T1', changes: { projects: [], plans: [], overrides: [] }, rejected: [] };
    });

    const settle = settleFirstSync('upload-mine', { send: slow, repo });
    // A second operation that never reaches the network at all: if the door
    // only wrapped `send`, this would sail past while the settle is still
    // writing its cursor.
    const look = inspectFirstSync({ send: vi.fn(), repo }).then((result) => {
      order.push('look done');
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(['settle: send']);

    release(undefined);
    await Promise.all([settle, look]);
    expect(order).toEqual(['settle: send', 'look done']);
  });
});

describe('a full download once damaged rows have been overwritten', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const cloudPlan = { ...plan, id: 'from-cloud', updatedAt: '2026-09-10T00:00:00.000Z' };

  it('sends no cursor while a download is owed, and the lost row comes back', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: 'T0', joined: true });
    // A blob this device cannot read, overwritten by an ordinary save: the
    // marker is raised by that write, not by the read that found the damage.
    localStorage.setItem('nowline.plans.v2', 'not json at all');
    await repo.savePlan({ ...plan, id: 'mine' });
    expect(await repo.readResyncOwed()).not.toBeNull();

    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1',
      changes: { projects: [], plans: [cloudPlan], overrides: [] },
      rejected: [],
    });
    const outcome = await syncOnce({ send, repo });

    expect(send.mock.calls[0][1]).toBeNull();
    expect(outcome).toEqual({ kind: 'done', downloaded: 1, stillOwed: 0 });
    expect((await repo.listPlans()).map((row) => row.id).sort()).toEqual(['from-cloud', 'mine']);
  });

  it('pays the download once: the next round sends the stored cursor', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: 'T0', joined: true });
    localStorage.setItem('nowline.plans.v2', 'not json at all');
    await repo.savePlan({ ...plan, id: 'mine' });
    const send = vi.fn().mockResolvedValue(emptyReply('T1'));

    await syncOnce({ send, repo });
    await syncOnce({ send, repo });

    expect(send.mock.calls.map((call) => call[1])).toEqual([null, 'T1']);
    expect(await repo.readResyncOwed()).toBeNull();
  });

  it('keeps a marker raised while the round was in flight, and pays it next time', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: 'T0', joined: true });
    // The damage sits on a key nothing has written to yet, so no download is
    // owed when the round starts...
    localStorage.setItem('nowline.overrides.v2', 'not json at all');
    // ...and the reply carries an override, so `applyFromServer` overwrites
    // the damaged key during the round and raises the marker after it was read.
    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1',
      changes: {
        projects: [],
        plans: [],
        overrides: [
          {
            id: 'o-cloud',
            planId: 'p1',
            date: '2026-09-03',
            status: 'scheduled',
            actualStart: null,
            actualEnd: null,
            startMinute: 600,
            durationMinutes: 30,
            updatedAt: '2026-09-10T00:00:00.000Z',
          },
        ],
      },
      rejected: [],
    });

    await syncOnce({ send, repo });
    expect(send.mock.calls[0][1]).toBe('T0');
    // This round read no marker, so it clears none: a round only ever clears
    // the value it read at its start. Clearing whatever stands at the end
    // would drop the marker the overwrite just raised — and that is the
    // mutation this line goes red under.
    expect(await repo.readResyncOwed()).not.toBeNull();

    send.mockResolvedValue(emptyReply('T2'));
    await syncOnce({ send, repo });
    expect(send.mock.calls[1][1]).toBeNull();
    expect(await repo.readResyncOwed()).toBeNull();
  });

  it('treats a damaged marker as owed: one full download, then it is gone', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: 'T0', joined: true });
    // Anything but null means owed — the spec's rule for a marker that is not
    // even a date. A round that validated the stamp would skip the download
    // and, if it still ran the clear, drop the marker without paying it.
    localStorage.setItem('nowline.resync.v1', 'not-a-date');
    const send = vi.fn().mockResolvedValue(emptyReply('T1'));

    await syncOnce({ send, repo });
    await syncOnce({ send, repo });

    expect(send.mock.calls.map((call) => call[1])).toEqual([null, 'T1']);
    expect(await repo.readResyncOwed()).toBeNull();
  });

  it('is paid by taking the cloud, which is already a full download', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: null, joined: false });
    // Damage on a key the replacement overwrites: `write` raises the marker inside
    // replaceAllFromServer, after any read the branch could have done beforehand.
    localStorage.setItem('nowline.plans.v2', 'not json at all');
    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1',
      changes: { projects: [], plans: [cloudPlan], overrides: [] },
      rejected: [],
    });

    await settleFirstSync('take-the-cloud', { send, repo, today: () => '2026-09-14' });

    expect(await repo.readResyncOwed()).toBeNull();
    // The quarantine is untouched: paying the marker is not forgetting the damage.
    expect(localStorage.getItem('nowline.plans.v2.corrupt')).toBe('not json at all');

    send.mockResolvedValue(emptyReply('T2'));
    await syncOnce({ send, repo });
    // Without the clear this reads [null, null]: a second full download for nothing.
    expect(send.mock.calls.map((call) => call[1])).toEqual([null, 'T1']);
  });
});

describe('the account the device holds', () => {
  beforeEach(() => {
    localStorage.clear();
    reported.mockClear();
  });

  it('keeps the account when the server stops accepting the token', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'stale', userId: 'u1', cursor: 'T1', joined: true });
    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'unauthorized', status: 401 });

    await syncOnce({ send, repo });

    // A dead token is not a different owner. Forgetting the account here would
    // make the same person's next sign-in ask whose rows these are.
    expect(await repo.readSyncState()).toEqual({ token: null, userId: 'u1', cursor: 'T1', joined: true });
  });

  it('keeps the account when a round goes through', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: 'u1', cursor: 'T1', joined: true });
    const send = vi.fn().mockResolvedValue(emptyReply('T2'));

    await syncOnce({ send, repo });

    expect(await repo.readSyncState()).toEqual({ token: 'abc', userId: 'u1', cursor: 'T2', joined: true });
  });

  it('keeps the account when the owner takes the cloud', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: 'u1', cursor: null, joined: false });
    await repo.savePlan({ ...plan, id: 'mine' });
    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1',
      changes: { projects: [], plans: [{ ...plan, id: 'theirs' }], overrides: [] },
      rejected: [],
    });

    await settleFirstSync('take-the-cloud', { send, repo, today: () => '2026-09-14' });

    expect(await repo.readSyncState()).toEqual({ token: 'abc', userId: 'u1', cursor: 'T1', joined: true });
  });

  it('keeps the account when the owner uploads his own', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: 'u1', cursor: null, joined: false });
    const send = vi.fn().mockResolvedValue(emptyReply('T1'));

    await settleFirstSync('upload-mine', { send, repo });

    expect(await repo.readSyncState()).toEqual({ token: 'abc', userId: 'u1', cursor: 'T1', joined: true });
  });

  it('learns the account from the first reply that names one', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: null, cursor: 'T0', joined: true });
    const send = vi.fn().mockResolvedValue({ ...emptyReply('T1'), userId: 'u1' });

    await syncOnce({ send, repo });

    // Every device from before accounts reaches here once. After that round it
    // knows whose rows it holds, long before a second account exists.
    expect(await repo.readSyncState()).toEqual({ token: 'abc', userId: 'u1', cursor: 'T1', joined: true });
  });

  it('takes nothing from a reply that names another account', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: 'u1', cursor: 'T0', joined: true });
    await repo.savePlan({ ...plan, id: 'mine' });
    const send = vi.fn().mockResolvedValue({
      serverTime: 'T1',
      changes: { projects: [], plans: [{ ...plan, id: 'theirs' }], overrides: [] },
      rejected: [],
      userId: 'u2',
    });

    const outcome = await syncOnce({ send, repo });

    // The token and its account are only ever written together, so this is a
    // defect somewhere. Applying the reply would put u2's rows on u1's device.
    expect(outcome).toEqual({ kind: 'refused', status: null });
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['mine']);
    expect((await repo.listPending()).plans).toEqual(['mine']);
    expect(await repo.readSyncState()).toEqual({ token: 'abc', userId: 'u1', cursor: 'T0', joined: true });
    expect(reported).toHaveBeenCalledOnce();
  });
});

describe('adoptSession', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const session = { token: 'new-token', userId: 'u2' };
  const today = () => '2026-09-14';
  const fresh = { token: 'new-token', userId: 'u2', cursor: null, joined: false };

  it('changes only the token when the session is for the account the device holds', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: null, userId: 'u2', cursor: 'T1', joined: true });
    await repo.savePlan({ ...plan, id: 'mine' });

    expect(await adoptSession(session, null, { repo, today })).toEqual({ kind: 'adopted' });

    // The same person signing in after a dead token: nothing is asked again,
    // nothing is downloaded again, and the unsent change is still owed.
    expect(await repo.readSyncState()).toEqual({ token: 'new-token', userId: 'u2', cursor: 'T1', joined: true });
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['mine']);
    expect((await repo.listPending()).plans).toEqual(['mine']);
  });

  it('empties the device, without a copy, when another account left nothing unsent', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    await repo.savePlan({ ...plan, id: 'theirs' });
    await repo.clearPending({ projects: [], plans: ['theirs'], overrides: [] });

    expect(await adoptSession(session, null, { repo, today })).toEqual({ kind: 'adopted' });

    expect(await repo.readSyncState()).toEqual(fresh);
    expect(await repo.listPlans()).toEqual([]);
    // Everything was in u1's cloud already; a copy would only spend storage quota.
    expect(localStorage.getItem('nowline.discarded.2026-09-14')).toBeNull();
  });

  it("asks before removing another account's unsent changes, and writes nothing", async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    await repo.savePlan({ ...plan, id: 'theirs' });

    expect(await adoptSession(session, null, { repo, today })).toEqual({ kind: 'other-account', atRisk: 1 });

    expect(await repo.readSyncState()).toEqual({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['theirs']);
  });

  it("keeps a copy of another account's unsent changes when told to remove them", async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    await repo.savePlan({ ...plan, id: 'theirs' });

    expect(await adoptSession(session, 'discard', { repo, today })).toEqual({ kind: 'adopted' });

    expect(await repo.readSyncState()).toEqual(fresh);
    expect(await repo.listPlans()).toEqual([]);
    expect(await repo.listPending()).toEqual({ projects: [], plans: [], overrides: [] });
    const kept = JSON.parse(localStorage.getItem('nowline.discarded.2026-09-14') ?? 'null');
    expect(kept.plans.map((row: { id: string }) => row.id)).toEqual(['theirs']);
  });

  it("does not keep another account's rows even when told to", async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    await repo.savePlan({ ...plan, id: 'theirs' });

    // "They are mine" is an answer about rows no account claims. These are
    // known to be u1's; keeping them under u2 is the merge this function prevents.
    expect(await adoptSession(session, 'keep', { repo, today })).toEqual({ kind: 'other-account', atRisk: 1 });
    expect(await repo.readSyncState()).toEqual({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['theirs']);
  });

  it('counts every row of a device that never joined, not only its queue', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: null, userId: 'u1', cursor: null, joined: false });
    await repo.savePlan({ ...plan, id: 'theirs' });
    await repo.clearPending({ projects: [], plans: ['theirs'], overrides: [] });

    // A device that never joined has sent nothing to any cloud, queued or not.
    expect(await adoptSession(session, null, { repo, today })).toEqual({ kind: 'other-account', atRisk: 1 });
    // Asking is not emptying: the rows are still here for whoever answers.
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['theirs']);
    expect(await repo.readSyncState()).toEqual({ token: null, userId: 'u1', cursor: null, joined: false });
  });

  it('adopts a device from before accounts that holds nothing, and forgets its cursor', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: null, userId: null, cursor: 'T1', joined: true });

    expect(await adoptSession(session, null, { repo, today })).toEqual({ kind: 'adopted' });

    // A cursor with no known owner may come from another account's stream, and
    // would skip every row in u2's cloud stamped before it.
    expect(await repo.readSyncState()).toEqual(fresh);
  });

  it('asks whoever holds a device from before accounts whether its rows are theirs', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: null, userId: null, cursor: 'T1', joined: true });
    await repo.savePlan({ ...plan, id: 'old' });
    await repo.clearPending({ projects: [], plans: ['old'], overrides: [] });

    expect(await adoptSession(session, null, { repo, today })).toEqual({ kind: 'unknown-owner', rows: 1 });

    expect(await repo.readSyncState()).toEqual({ token: null, userId: null, cursor: 'T1', joined: true });
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['old']);
  });

  it('leaves the rows to the first-sync question when the person says they are theirs', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: null, userId: null, cursor: 'T1', joined: true });
    await repo.savePlan({ ...plan, id: 'old' });

    expect(await adoptSession(session, 'keep', { repo, today })).toEqual({ kind: 'adopted' });

    // Not merged here: joined is false, so the next thing to run is the
    // first-sync question, which asks again if u2's cloud holds rows too.
    expect(await repo.readSyncState()).toEqual(fresh);
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['old']);
    expect(localStorage.getItem('nowline.discarded.2026-09-14')).toBeNull();
  });

  it('removes the rows of a device from before accounts, with a copy, when told to', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: null, userId: null, cursor: 'T1', joined: true });
    await repo.savePlan({ ...plan, id: 'old' });

    expect(await adoptSession(session, 'discard', { repo, today })).toEqual({ kind: 'adopted' });

    expect(await repo.readSyncState()).toEqual(fresh);
    expect(await repo.listPlans()).toEqual([]);
    const kept = JSON.parse(localStorage.getItem('nowline.discarded.2026-09-14') ?? 'null');
    expect(kept.plans.map((row: { id: string }) => row.id)).toEqual(['old']);
  });

  it('empties the keys instead of removing them, so the legacy rows do not come back', async () => {
    localStorage.setItem('tt.plans.v1', JSON.stringify([{ ...plan, id: 'legacy' }]));
    const repo = new LocalStorageRepository();
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['legacy']);
    await repo.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });

    expect(await adoptSession(session, null, { repo, today })).toEqual({ kind: 'adopted' });

    // The migration copies tt.*.v1 into any v2 key that is missing, once per
    // instance. A removed key would hand u1's pre-rename rows to u2 at next start.
    expect(await new LocalStorageRepository().listPlans()).toEqual([]);
  });

  it('pays the full-download marker its own emptying raised', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    localStorage.setItem('nowline.plans.v2', 'not json at all');

    await adoptSession(session, null, { repo, today });

    // Emptying overwrites the damaged key, and `write` raises the marker. The
    // new account starts at cursor null, which is a full download already.
    expect(await repo.readResyncOwed()).toBeNull();
    expect(localStorage.getItem('nowline.plans.v2.corrupt')).toBe('not json at all');
  });

  it('waits for a round already going before it counts what is at risk', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: 'u1', cursor: 'T0', joined: true });
    await repo.savePlan({ ...plan, id: 'theirs' });

    const order: string[] = [];
    let releaseRound: (value: unknown) => void = () => {};
    const send = vi.fn().mockImplementationOnce(async () => {
      order.push('round');
      await new Promise((resolve) => {
        releaseRound = resolve;
      });
      return emptyReply('T1');
    });

    const round = syncOnce({ send, repo });
    const adopt = adoptSession(session, null, { repo, today });
    await vi.waitFor(() => expect(order).toEqual(['round']));

    releaseRound(undefined);
    await round;
    // The round delivered u1's change before the count. Counted outside the
    // engine's door, it would be 1, and the question would be about a change
    // already in u1's cloud.
    expect(await adopt).toEqual({ kind: 'adopted' });
  });
});

describe('signOut', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const today = () => '2026-09-17';
  const signedOut = { token: null, userId: null, cursor: null, joined: false };

  async function deviceWithOneUnsentChange() {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: 'u1', cursor: 'T1', joined: true });
    await repo.savePlan({ ...plan, id: 'mine' });
    return repo;
  }

  it('uploads what is owed first, then revokes the live token, then empties the device', async () => {
    const repo = await deviceWithOneUnsentChange();
    const send = vi.fn().mockResolvedValue(emptyReply('T2'));
    const revoke = vi.fn().mockResolvedValue(true);

    expect(await signOut(null, { send, revoke, repo, today })).toEqual({ kind: 'signed-out' });

    // The round carried the change up; nothing was at risk, so no copy was kept.
    expect(send.mock.calls[0][2].plans.map((row: { id: string }) => row.id)).toEqual(['mine']);
    expect(revoke).toHaveBeenCalledWith('abc');
    expect(await repo.readSyncState()).toEqual(signedOut);
    expect(await repo.listPlans()).toEqual([]);
    expect(localStorage.getItem('nowline.discarded.2026-09-17')).toBeNull();
  });

  it('changes nothing when there is no network', async () => {
    const repo = await deviceWithOneUnsentChange();
    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'offline', status: null, detail: null });
    const revoke = vi.fn();

    expect(await signOut(null, { send, revoke, repo, today })).toEqual({ kind: 'offline' });

    // Signing out reaches the server, like an upload does. Until it can, the
    // device stays signed in with its change still owed.
    expect(revoke).not.toHaveBeenCalled();
    expect(await repo.readSyncState()).toEqual({ token: 'abc', userId: 'u1', cursor: 'T1', joined: true });
    expect((await repo.listPending()).plans).toEqual(['mine']);
  });

  it('answers refused when the round is refused, and writes nothing', async () => {
    const repo = await deviceWithOneUnsentChange();
    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'refused', status: 500, detail: null });
    const revoke = vi.fn();

    expect(await signOut(null, { send, revoke, repo, today })).toEqual({ kind: 'refused', status: 500 });

    expect(revoke).not.toHaveBeenCalled();
    expect(await repo.readSyncState()).toEqual({ token: 'abc', userId: 'u1', cursor: 'T1', joined: true });
    expect((await repo.listPending()).plans).toEqual(['mine']);
  });

  it('asks before removing what the server did not take, and writes nothing', async () => {
    const repo = await deviceWithOneUnsentChange();
    const send = vi.fn().mockResolvedValue({ ...emptyReply('T2'), rejected: ['mine'] });
    const revoke = vi.fn();

    expect(await signOut(null, { send, revoke, repo, today })).toEqual({ kind: 'at-risk', atRisk: 1 });

    expect(revoke).not.toHaveBeenCalled();
    expect((await repo.listPending()).plans).toEqual(['mine']);
    expect((await repo.readSyncState()).token).toBe('abc');
  });

  it('keeps a copy when the owner discards what was at risk', async () => {
    const repo = await deviceWithOneUnsentChange();
    const send = vi.fn().mockResolvedValue({ ...emptyReply('T2'), rejected: ['mine'] });
    const revoke = vi.fn().mockResolvedValue(true);

    expect(await signOut('discard', { send, revoke, repo, today })).toEqual({ kind: 'signed-out' });

    expect(revoke).toHaveBeenCalledWith('abc');
    expect(await repo.readSyncState()).toEqual(signedOut);
    expect(await repo.listPlans()).toEqual([]);
    expect(localStorage.getItem('nowline.discarded.2026-09-17')).not.toBeNull();
  });

  it('skips the revoke when the round found the token already dead', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: 'u1', cursor: 'T1', joined: true });
    const send = vi.fn().mockResolvedValue({ failed: true, kind: 'unauthorized', status: 401, detail: null });
    const revoke = vi.fn();

    expect(await signOut(null, { send, revoke, repo, today })).toEqual({ kind: 'signed-out' });

    // There is no session left to forget; asking the server would only 401 again.
    expect(revoke).not.toHaveBeenCalled();
    expect(await repo.readSyncState()).toEqual(signedOut);
  });

  it('stays signed in when the server could not be asked to forget the session', async () => {
    const repo = await deviceWithOneUnsentChange();
    const send = vi.fn().mockResolvedValue(emptyReply('T2'));
    const revoke = vi.fn().mockResolvedValue({ failed: true, kind: 'offline', status: null, detail: null });

    expect(await signOut(null, { send, revoke, repo, today })).toEqual({ kind: 'offline' });

    // The revoke comes before the reset on purpose: a device emptied while the
    // server still honours its token is a session nobody can end.
    expect((await repo.readSyncState()).token).toBe('abc');
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['mine']);
  });

  it('stays signed in when the server refused to forget the session', async () => {
    const repo = await deviceWithOneUnsentChange();
    const send = vi.fn().mockResolvedValue(emptyReply('T2'));
    const revoke = vi.fn().mockResolvedValue({ failed: true, kind: 'refused', status: 500, detail: null });

    expect(await signOut(null, { send, revoke, repo, today })).toEqual({ kind: 'refused', status: 500 });

    expect((await repo.readSyncState()).token).toBe('abc');
    expect((await repo.listPlans()).map((row) => row.id)).toEqual(['mine']);
  });

  it('counts every row on a device that never joined', async () => {
    const repo = new LocalStorageRepository();
    await repo.writeSyncState({ token: 'abc', userId: 'u1', cursor: null, joined: false });
    await repo.savePlan({ ...plan, id: 'p1' });
    await repo.savePlan({ ...plan, id: 'p2' });
    const send = vi.fn();
    const revoke = vi.fn();

    expect(await signOut(null, { send, revoke, repo, today })).toEqual({ kind: 'at-risk', atRisk: 2 });

    // No round runs before the first-sync question is answered, so nothing here
    // has ever reached a cloud.
    expect(send).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });
});
