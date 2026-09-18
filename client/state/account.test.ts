// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../storage/sync', () => ({
  inspectFirstSync: vi.fn(),
  settleFirstSync: vi.fn(),
  syncOnce: vi.fn(),
  signOut: vi.fn(),
}));

import * as apiClient from '../storage/apiClient';
import { repository } from '../storage/repository';
import { inspectFirstSync, signOut } from '../storage/sync';
import { decideEntry, getState, loadAccount, loadAll, setTab, signOutOfDevice } from './store';

const look = inspectFirstSync as Mock;
const leave = signOut as Mock;

const ana = { userId: 'u1', email: 'ana@example.com', verifiedAt: null };

async function signedInAndReady(): Promise<void> {
  await repository.writeSyncState({ token: 'abc', userId: 'u1', cursor: 'T1', joined: true });
  look.mockResolvedValue({ kind: 'already-joined' });
  await decideEntry();
  expect(getState().entry).toBe('ready');
}

describe('the account tab', () => {
  beforeEach(async () => {
    localStorage.clear();
    look.mockReset();
    leave.mockReset();
    await loadAll();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('asks the server once who the token belongs to, and keeps the answer', async () => {
    await signedInAndReady();
    const me = vi.spyOn(apiClient, 'me').mockResolvedValue(ana);

    await loadAccount();

    expect(me).toHaveBeenCalledWith('abc');
    expect(getState().account).toEqual(ana);
    expect(getState().accountFailure).toBeNull();
  });

  it('keeps the failure when the server did not answer, so the tab can say so', async () => {
    await signedInAndReady();
    vi.spyOn(apiClient, 'me').mockResolvedValue({ failed: true, kind: 'offline', status: null, detail: null });

    await loadAccount();

    expect(getState().account).toBeNull();
    expect(getState().accountFailure).toEqual({ failed: true, kind: 'offline', status: null, detail: null });
    expect(getState().entry).toBe('ready');
  });

  it('sends the owner to sign in when the session is over', async () => {
    await signedInAndReady();
    vi.spyOn(apiClient, 'me').mockResolvedValue({ failed: true, kind: 'unauthorized', status: 401, detail: null });

    await loadAccount();

    // Same rule as a rejected round: the calendar would never sync again.
    expect(getState().entry).toBe('signed-out');
    expect(getState().account).toBeNull();
  });

  it('does not ask at all when the engine already dropped the token', async () => {
    await signedInAndReady();
    await repository.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    const me = vi.spyOn(apiClient, 'me');

    await loadAccount();

    expect(me).not.toHaveBeenCalled();
    expect(getState().entry).toBe('signed-out');
  });

  it('leaves the account on this device, and decides the entry again from the calendar tab', async () => {
    await signedInAndReady();
    vi.spyOn(apiClient, 'me').mockResolvedValue(ana);
    await loadAccount();
    setTab('account');
    leave.mockImplementation(async () => {
      await repository.writeSyncState({ token: null, userId: null, cursor: null, joined: false });
      return { kind: 'signed-out' };
    });

    expect(await signOutOfDevice(null)).toEqual({ kind: 'signed-out' });

    expect(leave).toHaveBeenCalledWith(null);
    expect(getState().entry).toBe('signed-out');
    expect(getState().account).toBeNull();
    // Whoever signs in next starts on the calendar, not on the tab that was left.
    expect(getState().tab).toBe('calendar');
  });

  it('hands the question back without changing anything, and carries the answer through', async () => {
    await signedInAndReady();
    vi.spyOn(apiClient, 'me').mockResolvedValue(ana);
    await loadAccount();
    setTab('account');
    leave.mockResolvedValue({ kind: 'at-risk', atRisk: 3 });

    expect(await signOutOfDevice(null)).toEqual({ kind: 'at-risk', atRisk: 3 });

    expect(getState().entry).toBe('ready');
    expect(getState().tab).toBe('account');
    expect(getState().account).toEqual(ana);

    leave.mockResolvedValue({ kind: 'offline' });
    expect(await signOutOfDevice('discard')).toEqual({ kind: 'offline' });
    expect(leave).toHaveBeenLastCalledWith('discard');
    expect(getState().entry).toBe('ready');

    leave.mockResolvedValue({ kind: 'refused', status: 500 });
    expect(await signOutOfDevice(null)).toEqual({ kind: 'refused', status: 500 });
    expect(getState().entry).toBe('ready');
    expect(getState().tab).toBe('account');
    expect(getState().account).toEqual(ana);
  });
});
