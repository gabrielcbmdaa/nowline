// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repository } from '../storage/repository';
import { adoptSession } from '../storage/sync';
import { decideEntry, getState, loadAll } from './store';

const emptyCloud = {
  serverTime: '2026-09-16T10:00:00.000Z',
  changes: { projects: [], plans: [], overrides: [] },
  rejected: [],
  userId: 'u-new',
};

describe('a new account on a fresh device', () => {
  beforeEach(async () => {
    localStorage.clear();
    await loadAll();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens the calendar without asking what to do with two copies', async () => {
    const fetcher = vi.fn().mockResolvedValue({ status: 200, ok: true, json: async () => emptyCloud });
    vi.stubGlobal('fetch', fetcher);

    // What CreateAccountScreen does with the session register handed back.
    expect(await adoptSession({ token: 'new-token', userId: 'u-new' }, null)).toEqual({ kind: 'adopted' });
    await decideEntry();

    // Nothing on either side, so nothing to choose between: the question would
    // be a screen with two buttons that both mean "carry on".
    expect(getState().entry).toBe('ready');
    expect(getState().firstSync).toBeNull();
    expect(await repository.readSyncState()).toEqual({
      token: 'new-token',
      userId: 'u-new',
      cursor: '2026-09-16T10:00:00.000Z',
      joined: true,
    });
    // One look at the cloud, then the one empty round that joins the device.
    expect(fetcher).toHaveBeenCalledTimes(2);
    // The route, not only the destination: taking the cloud always keeps a copy
    // of what it replaces, so the absence of one says the join was an upload.
    expect(Object.keys(localStorage).filter((key) => key.startsWith('nowline.discarded.'))).toEqual([]);
  });
});
