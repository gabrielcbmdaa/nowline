// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../storage/sync', () => ({
  inspectFirstSync: vi.fn(),
  settleFirstSync: vi.fn(),
  syncOnce: vi.fn(),
}));

import { inspectFirstSync, settleFirstSync } from '../storage/sync';
import { repository } from '../storage/repository';
import { decideEntry, getState, loadAll } from './store';

const look = inspectFirstSync as Mock;
const settle = settleFirstSync as Mock;

describe('deciding what the app shows', () => {
  beforeEach(async () => {
    localStorage.clear();
    look.mockReset();
    settle.mockReset();
    await loadAll();
  });

  it('shows the sign-in screen when there is no token', async () => {
    await decideEntry();

    expect(getState().entry).toBe('signed-out');
    // No token means no question to ask the server; asking would spend a
    // request to be told what storage already knew.
    expect(look).not.toHaveBeenCalled();
  });

  it('does not show the first-sync question to a device that already joined', async () => {
    await repository.writeSyncState({ token: 'abc', cursor: 'T1', joined: true });
    look.mockResolvedValue({ kind: 'already-joined' });

    await decideEntry();

    // The trap the engine was changed to prevent: one of the buttons on that
    // screen replaces everything written since the device joined.
    expect(getState().entry).toBe('ready');
    expect(getState().firstSync).toBeNull();
    expect(settle).not.toHaveBeenCalled();
  });

  it('shows loading while the engine is still deciding', async () => {
    await decideEntry();
    expect(getState().entry).toBe('signed-out');

    await repository.writeSyncState({ token: 'abc', cursor: null, joined: false });
    look.mockReturnValue(new Promise(() => {}));

    void decideEntry();

    await vi.waitFor(() => expect(getState().entry).toBe('deciding'));
  });

  it('asks when both sides hold rows, and carries the counts to the screen', async () => {
    await repository.writeSyncState({ token: 'abc', cursor: null, joined: false });
    look.mockResolvedValue({ kind: 'ask', local: 34, remote: 120 });

    await decideEntry();

    expect(getState().entry).toBe('asking-first-sync');
    expect(getState().firstSync).toEqual({ local: 34, remote: 120 });
  });

  it('carries out a recommendation instead of treating it as done', async () => {
    await repository.writeSyncState({ token: 'abc', cursor: null, joined: false });
    look.mockResolvedValue({ kind: 'settled', choice: 'upload-mine' });
    settle.mockResolvedValue({ kind: 'done', downloaded: 0, stillOwed: 0 });

    await decideEntry();

    // `settled` says what the engine would choose, not that anybody joined.
    expect(settle).toHaveBeenCalledWith('upload-mine');
    expect(getState().entry).toBe('ready');
  });

  it('does not call itself ready when the recommendation could not be carried out', async () => {
    await repository.writeSyncState({ token: 'abc', cursor: null, joined: false });
    look.mockResolvedValue({ kind: 'settled', choice: 'upload-mine' });
    settle.mockResolvedValue({ kind: 'offline' });

    await decideEntry();

    expect(getState().entry).toBe('signed-out');
    expect(getState().firstSync).toBeNull();
  });

  it('goes back to signing in when the token stops working', async () => {
    await repository.writeSyncState({ token: 'stale', cursor: null, joined: false });
    look.mockResolvedValue({ kind: 'unauthorized' });

    await decideEntry();

    expect(getState().entry).toBe('signed-out');
    expect(await repository.readSyncState()).toEqual({
      token: 'stale',
      cursor: null,
      joined: false,
    });
  });

  it('does not claim to be ready when nobody answered', async () => {
    await repository.writeSyncState({ token: 'abc', cursor: null, joined: false });
    look.mockResolvedValue({ kind: 'offline' });

    await decideEntry();

    // Showing the calendar here would let the four wake-ups run against a
    // device that never answered the question — which the engine refuses, so
    // the owner would see an app that silently never syncs.
    expect(getState().entry).toBe('signed-out');
    expect(getState().firstSync).toBeNull();
  });

  it('shows the rows a carried-out recommendation brought down', async () => {
    await repository.writeSyncState({ token: 'abc', cursor: null, joined: false });
    look.mockResolvedValue({ kind: 'settled', choice: 'take-the-cloud' });
    // The real settle writes the cloud's rows into storage and repaints
    // nothing. Stand in for that with one row, so the store has to notice.
    settle.mockImplementation(async () => {
      await repository.saveProject({
        id: 'from-the-cloud',
        name: 'Cloud',
        color: '#000000',
        createdAt: '2026-09-11T10:00:00Z',
        updatedAt: '2026-09-11T10:00:00Z',
        deletedAt: null,
      });
      return { kind: 'done', downloaded: 1, stillOwed: 0 };
    });

    await decideEntry();

    // Memory still held the empty boot load; without a reload after the settle
    // the calendar opens empty and `syncNow` will not reload either, because
    // its next round downloads nothing new.
    expect(getState().entry).toBe('ready');
    expect(getState().projects.map((project) => project.id)).toContain('from-the-cloud');
  });
});
