// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('../../storage/sync', () => ({
  inspectFirstSync: vi.fn(),
  settleFirstSync: vi.fn(),
  syncOnce: vi.fn(),
  signOut: vi.fn(),
}));

import * as apiClient from '../../storage/apiClient';
import { repository } from '../../storage/repository';
import { inspectFirstSync, signOut } from '../../storage/sync';
import { decideEntry, getState, loadAll } from '../../state/store';
import { AccountScreen } from './AccountScreen';

const look = inspectFirstSync as Mock;
const leave = signOut as Mock;

async function signedIn(): Promise<void> {
  await repository.writeSyncState({ token: 'abc', userId: 'u1', cursor: 'T1', joined: true });
  look.mockResolvedValue({ kind: 'already-joined' });
  await decideEntry();
}

describe('AccountScreen', () => {
  beforeEach(async () => {
    localStorage.clear();
    look.mockReset();
    leave.mockReset();
    await loadAll();
    await signedIn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('asks who the token belongs to once, and shows the address as confirmed', async () => {
    const me = vi
      .spyOn(apiClient, 'me')
      .mockResolvedValue({ userId: 'u1', email: 'ana@example.com', verifiedAt: '2026-09-17T10:00:00.000Z' });
    const { rerender } = render(<AccountScreen />);

    await vi.waitFor(() => expect(screen.getByText('ana@example.com')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Email' })).toBeTruthy();
    expect(screen.getByText('Confirmed')).toBeTruthy();

    // Deciding costs a request; a render must not.
    rerender(<AccountScreen />);
    expect(me).toHaveBeenCalledTimes(1);
  });

  it('says the address is not confirmed yet', async () => {
    vi.spyOn(apiClient, 'me').mockResolvedValue({ userId: 'u1', email: 'ana@example.com', verifiedAt: null });
    render(<AccountScreen />);

    await vi.waitFor(() => expect(screen.getByText('Not confirmed')).toBeTruthy());
  });

  it('says there is no email, and why one matters', async () => {
    // A released account: its address went to someone else after 24 hours unconfirmed.
    vi.spyOn(apiClient, 'me').mockResolvedValue({ userId: 'u1', email: null, verifiedAt: null });
    render(<AccountScreen />);

    await vi.waitFor(() =>
      expect(
        screen.getByText('No email on this account. Add one to sign in on other devices and recover your password.'),
      ).toBeTruthy(),
    );
  });

  it('shows loading, then the failure with a way to try again', async () => {
    const me = vi
      .spyOn(apiClient, 'me')
      .mockResolvedValueOnce({ failed: true, kind: 'offline', status: null, detail: null })
      .mockResolvedValueOnce({ userId: 'u1', email: 'ana@example.com', verifiedAt: null });
    render(<AccountScreen />);

    expect(screen.getByText('Loading…')).toBeTruthy();
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/no answer|connection/i));

    screen.getByRole('button', { name: 'Try again' }).click();

    await vi.waitFor(() => expect(screen.getByText('ana@example.com')).toBeTruthy());
    expect(me).toHaveBeenCalledTimes(2);
  });

  it('does not decide anything itself: a dead session is the store\'s to notice', async () => {
    vi.spyOn(apiClient, 'me').mockResolvedValue({ failed: true, kind: 'unauthorized', status: 401, detail: null });
    render(<AccountScreen />);

    await vi.waitFor(() => expect(getState().entry).toBe('signed-out'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(leave).not.toHaveBeenCalled();
  });
});
