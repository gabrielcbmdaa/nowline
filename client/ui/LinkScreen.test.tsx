// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockPlan } from '../domain/types';

vi.mock('../reportError', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

import * as apiClient from '../storage/apiClient';
import { repository } from '../storage/repository';
import { LinkScreen } from './LinkScreen';

const TOKEN = 'ef'.repeat(32);

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

function clickButton(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

/** Lets every effect of the first render run, and any promise it started settle. */
async function settle(): Promise<void> {
  await act(async () => {
    // A microtask flushes the effects of the first render; a macrotask as well,
    // so a consume deferred with setTimeout(…, 0) is still "on load" to this
    // test. Mail scanners open the page and press nothing.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('LinkScreen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('confirming an address', () => {
    it('spends nothing by being opened; pressing its button does', async () => {
      const confirm = vi.spyOn(apiClient, 'confirmLink').mockResolvedValue({ confirmed: 'email' });
      const onDone = vi.fn();
      render(<LinkScreen link={{ kind: 'confirm', token: TOKEN }} onDone={onDone} />);
      await settle();

      // Mail clients and scanners open links to preview them. A page that spent
      // the token on load would hand the person a link that was already used.
      expect(confirm).not.toHaveBeenCalled();

      clickButton('Confirm email');
      await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('Email confirmed.'));

      expect(confirm).toHaveBeenCalledWith(TOKEN);
      expect(onDone).not.toHaveBeenCalled();
      clickButton('Continue');
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('says which address the account has now, after a change', async () => {
      vi.spyOn(apiClient, 'confirmLink').mockResolvedValue({ confirmed: 'new-email', email: 'new@example.com' });
      render(<LinkScreen link={{ kind: 'confirm', token: TOKEN }} onDone={vi.fn()} />);

      clickButton('Confirm email');

      await vi.waitFor(() =>
        expect(screen.getByRole('status').textContent).toBe('Your email is now new@example.com.'),
      );
    });

    it('says a spent link is spent, and still lets the person leave', async () => {
      vi.spyOn(apiClient, 'confirmLink').mockResolvedValue({
        failed: true,
        kind: 'refused',
        status: 410,
        detail: { error: 'link expired or used' },
      });
      const onDone = vi.fn();
      render(<LinkScreen link={{ kind: 'confirm', token: TOKEN }} onDone={onDone} />);

      clickButton('Confirm email');
      await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

      expect(screen.getByRole('alert').textContent).toBe(
        'This link has expired or was already used. Ask for a new one.',
      );
      clickButton('Not now');
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it('can be left without spending the link', async () => {
      const confirm = vi.spyOn(apiClient, 'confirmLink').mockResolvedValue({ confirmed: 'email' });
      const onDone = vi.fn();
      render(<LinkScreen link={{ kind: 'confirm', token: TOKEN }} onDone={onDone} />);

      clickButton('Not now');
      await settle();

      expect(onDone).toHaveBeenCalledTimes(1);
      expect(confirm).not.toHaveBeenCalled();
    });
  });

  describe('choosing a new password', () => {
    it('spends nothing by being opened', async () => {
      const reset = vi.spyOn(apiClient, 'resetPassword').mockResolvedValue({ token: 'fresh', userId: 'u1' });
      render(<LinkScreen link={{ kind: 'reset', token: TOKEN }} onDone={vi.fn()} />);
      await settle();

      expect(reset).not.toHaveBeenCalled();
    });

    it('changes the password with the link, and hands the new session to the engine', async () => {
      const reset = vi.spyOn(apiClient, 'resetPassword').mockResolvedValue({ token: 'fresh', userId: 'u1' });
      await repository.writeSyncState({ token: 'revoked', userId: 'u1', cursor: 'T1', joined: true });
      const onDone = vi.fn();
      render(<LinkScreen link={{ kind: 'reset', token: TOKEN }} onDone={onDone} />);

      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-new-long-password' } });
      clickButton('Change password');
      await vi.waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));

      expect(reset).toHaveBeenCalledWith(TOKEN, 'a-new-long-password');
      // The reset ended every session of the account, this device's included;
      // the new one replaces it and nothing else changes.
      expect(await repository.readSyncState()).toEqual({ token: 'fresh', userId: 'u1', cursor: 'T1', joined: true });
    });

    it("keeps the form when the password is refused, and says the server's minimum", async () => {
      vi.spyOn(apiClient, 'resetPassword').mockResolvedValue({
        failed: true,
        kind: 'refused',
        status: 400,
        detail: { error: 'password too short', minimum: 12 },
      });
      const onDone = vi.fn();
      render(<LinkScreen link={{ kind: 'reset', token: TOKEN }} onDone={onDone} />);

      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } });
      clickButton('Change password');
      await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

      // The server checks the length before it spends the link, so trying again works.
      expect(screen.getByRole('alert').textContent).toBe('Use at least 12 characters.');
      expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy();
      expect(onDone).not.toHaveBeenCalled();
    });

    it('says the password changed but the device was left alone, when the other-account question is cancelled', async () => {
      vi.spyOn(apiClient, 'resetPassword').mockResolvedValue({ token: 'fresh', userId: 'u2' });
      const logout = vi.spyOn(apiClient, 'logout').mockResolvedValue(true);
      await repository.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
      await repository.savePlan({ ...plan, id: 'theirs' });
      const onDone = vi.fn();
      render(<LinkScreen link={{ kind: 'reset', token: TOKEN }} onDone={onDone} />);

      fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a-new-long-password' } });
      clickButton('Change password');
      await vi.waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy());
      clickButton(/cancel/i);

      // The link is spent and the password changed; only this device stayed as it was.
      expect(screen.getByRole('status').textContent).toBe(
        'Your password has changed. This device was left as it was; sign in when you are ready.',
      );
      expect(logout).toHaveBeenCalledWith('fresh');
      expect(await repository.readSyncState()).toEqual({ token: null, userId: 'u1', cursor: 'T1', joined: true });
      clickButton('Continue');
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });
});
