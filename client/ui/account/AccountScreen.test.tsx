// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
import { CONFIRM_ARMS_AFTER_MS } from '../FirstSyncScreen';
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
    vi.useRealTimers();
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
    expect(screen.queryByRole('button', { name: 'Resend confirmation' })).toBeNull();
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

  it('resends the confirmation, and says where it went', async () => {
    vi.spyOn(apiClient, 'me').mockResolvedValue({ userId: 'u1', email: 'ana@example.com', verifiedAt: null });
    const send = vi.spyOn(apiClient, 'sendConfirmation').mockResolvedValue({ sent: true });
    render(<AccountScreen />);
    await vi.waitFor(() => expect(screen.getByText('Not confirmed')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation' }));

    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('Sent to ana@example.com.'));
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Resend confirmation' })).toBeNull();
  });

  it('says so when the email could not leave, and keeps the button', async () => {
    vi.spyOn(apiClient, 'me').mockResolvedValue({ userId: 'u1', email: 'ana@example.com', verifiedAt: null });
    vi.spyOn(apiClient, 'sendConfirmation').mockResolvedValue({ sent: false });
    render(<AccountScreen />);
    await vi.waitFor(() => expect(screen.getByText('Not confirmed')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation' }));

    // The account is unchanged; a "sent" line here would be a lie.
    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('The email could not be sent. Try again in a few minutes.'),
    );
    expect(screen.getByRole('button', { name: 'Resend confirmation' })).toBeTruthy();
  });

  it('says the door is shut after too many resends', async () => {
    vi.spyOn(apiClient, 'me').mockResolvedValue({ userId: 'u1', email: 'ana@example.com', verifiedAt: null });
    vi.spyOn(apiClient, 'sendConfirmation').mockResolvedValue({
      failed: true,
      kind: 'refused',
      status: 429,
      detail: { error: 'too many attempts' },
    });
    render(<AccountScreen />);
    await vi.waitFor(() => expect(screen.getByText('Not confirmed')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Resend confirmation' }));

    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/too many attempts/i));
  });

  it('does not offer to resend when the address is already confirmed', async () => {
    vi.spyOn(apiClient, 'me').mockResolvedValue({ userId: 'u1', email: 'ana@example.com', verifiedAt: '2026-09-17T10:00:00.000Z' });
    render(<AccountScreen />);

    await vi.waitFor(() => expect(screen.getByText('Confirmed')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Resend confirmation' })).toBeNull();
  });

  function typeInto(label: string, value: string): void {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }

  async function openChangeEmail(): Promise<void> {
    vi.spyOn(apiClient, 'me').mockResolvedValue({ userId: 'u1', email: 'ana@example.com', verifiedAt: '2026-09-17T10:00:00.000Z' });
    render(<AccountScreen />);
    await vi.waitFor(() => expect(screen.getByText('ana@example.com')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Change email' }));
  }

  it('asks for the new address and the current password, and says where the link went', async () => {
    const change = vi.spyOn(apiClient, 'changeEmail').mockResolvedValue({ sent: true });
    await openChangeEmail();

    const form = screen.getByRole('form', { name: 'Change email' });
    if (!(form instanceof HTMLFormElement)) throw new Error('expected a form');
    expect(form.noValidate).toBe(true);
    typeInto('New email', 'new@example.com');
    typeInto('Current password', 'the-current-password');
    fireEvent.click(screen.getByRole('button', { name: 'Send confirmation' }));

    await vi.waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(
        'Check new@example.com for a link. Your email changes when you open it.',
      ),
    );
    expect(change).toHaveBeenCalledWith('abc', 'new@example.com', 'the-current-password');
    // The address on the account has not changed yet; the link does that.
    expect(screen.getByText('ana@example.com')).toBeTruthy();
    expect(screen.queryByRole('form', { name: 'Change email' })).toBeNull();
  });

  it('says the password is wrong, keeps the form, and stays signed in', async () => {
    vi.spyOn(apiClient, 'changeEmail').mockResolvedValue({
      failed: true,
      kind: 'refused',
      status: 403,
      detail: { error: 'wrong password' },
    });
    await openChangeEmail();

    typeInto('New email', 'new@example.com');
    typeInto('Current password', 'typo');
    fireEvent.click(screen.getByRole('button', { name: 'Send confirmation' }));

    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toBe('The password is wrong.'));
    expect(screen.getByRole('form', { name: 'Change email' })).toBeTruthy();
    const newEmail = screen.getByLabelText('New email');
    if (!(newEmail instanceof HTMLInputElement)) throw new Error('expected an input');
    expect(newEmail.value).toBe('new@example.com');
    const currentPassword = screen.getByLabelText('Current password');
    if (!(currentPassword instanceof HTMLInputElement)) throw new Error('expected an input');
    expect(currentPassword.value).toBe('typo');
    expect(getState().entry).toBe('ready');
  });

  it('says so when the link could not be sent', async () => {
    vi.spyOn(apiClient, 'changeEmail').mockResolvedValue({ sent: false });
    await openChangeEmail();

    typeInto('New email', 'new@example.com');
    typeInto('Current password', 'the-current-password');
    fireEvent.click(screen.getByRole('button', { name: 'Send confirmation' }));

    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('The email could not be sent. Try again in a few minutes.'),
    );
    expect(screen.getByRole('form', { name: 'Change email' })).toBeTruthy();
  });

  it('folds the form away on Cancel without asking the server', async () => {
    const change = vi.spyOn(apiClient, 'changeEmail');
    await openChangeEmail();

    typeInto('New email', 'new@example.com');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('form', { name: 'Change email' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Change email' })).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
  });

  async function signedInTab(): Promise<void> {
    vi.spyOn(apiClient, 'me').mockResolvedValue({ userId: 'u1', email: 'ana@example.com', verifiedAt: '2026-09-17T10:00:00.000Z' });
    render(<AccountScreen />);
    await vi.waitFor(() => expect(screen.getByText('ana@example.com')).toBeTruthy());
  }

  it('signs out through the engine when nothing is at risk', async () => {
    leave.mockImplementation(async () => {
      await repository.writeSyncState({ token: null, userId: null, cursor: null, joined: false });
      return { kind: 'signed-out' };
    });
    await signedInTab();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await vi.waitFor(() => expect(getState().entry).toBe('signed-out'));
    expect(leave).toHaveBeenCalledWith(null);
  });

  it('asks before removing unsent changes, arms the answer after the delay, and carries it through', async () => {
    leave.mockResolvedValueOnce({ kind: 'at-risk', atRisk: 3 }).mockImplementationOnce(async () => {
      await repository.writeSyncState({ token: null, userId: null, cursor: null, joined: false });
      return { kind: 'signed-out' };
    });
    await signedInTab();
    // Fake timers only from here: the arm delay is what this test measures.
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(
      screen.getByText(
        '3 changes have not been uploaded and will be removed from this device; a copy stays in its storage.',
      ),
    ).toBeTruthy();
    const anyway = screen.getByRole('button', { name: 'Sign out anyway' });
    if (!(anyway instanceof HTMLButtonElement)) throw new Error('expected a button');
    // A second tap of a double tap on "Sign out" must land on a button that does nothing yet.
    expect(anyway.disabled).toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(CONFIRM_ARMS_AFTER_MS));
    expect(anyway.disabled).toBe(false);

    fireEvent.click(anyway);
    await act(() => vi.advanceTimersByTimeAsync(0));

    expect(leave).toHaveBeenLastCalledWith('discard');
    expect(getState().entry).toBe('signed-out');
  });

  it('speaks in the singular about one change', async () => {
    leave.mockResolvedValue({ kind: 'at-risk', atRisk: 1 });
    await signedInTab();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await vi.waitFor(() =>
      expect(
        screen.getByText('1 change has not been uploaded and will be removed from this device; a copy stays in its storage.'),
      ).toBeTruthy(),
    );
  });

  it('folds the question away on Cancel, and says nothing answered when there is no network', async () => {
    leave
      .mockResolvedValueOnce({ kind: 'at-risk', atRisk: 2 })
      .mockResolvedValueOnce({ kind: 'offline' })
      .mockResolvedValueOnce({ kind: 'refused', status: 500 });
    await signedInTab();

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('button', { name: 'Sign out anyway' })).toBeNull();
    expect(getState().entry).toBe('ready');

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/no answer|connection/i));
    expect(getState().entry).toBe('ready');

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('The server did not accept the request (500).'),
    );
    expect(getState().entry).toBe('ready');
  });
});
