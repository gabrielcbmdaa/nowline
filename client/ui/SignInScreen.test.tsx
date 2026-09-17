// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { BlockPlan } from '../domain/types';

vi.mock('../reportError', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

import { reportError } from '../reportError';
import * as apiClient from '../storage/apiClient';
import { repository } from '../storage/repository';
import * as sync from '../storage/sync';
import { CONFIRM_ARMS_AFTER_MS } from './FirstSyncScreen';
import { SignInScreen } from './SignInScreen';

const reported = reportError as Mock;

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

function typeInto(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function clickButton(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('SignInScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    reported.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps the token where the engine looks for it', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token', userId: 'u1' });
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} onSwitch={vi.fn()} />);

    typeInto('Email', 'gabriel@example.com');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalled());

    // login() hands the token back and stores nothing. Until this screen writes
    // it, every round the engine runs answers `unauthorized`.
    const stored = await repository.readSyncState();
    expect(stored.token).toBe('a-real-token');
    expect(stored.userId).toBe('u1');
    expect(onSignedIn).toHaveBeenCalled();
  });

  it('does not touch the joined flag when it stores a token', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token', userId: 'u1' });
    await repository.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    render(<SignInScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    typeInto('Email', 'gabriel@example.com');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await vi.waitFor(async () => expect((await repository.readSyncState()).token).toBe('a-real-token'));

    // Signing in again after a token expired is not joining again. Writing
    // `joined: false` here would make a device that joined months ago ask the
    // once-in-a-lifetime question a second time, and one of its answers throws
    // away everything written since.
    const state = await repository.readSyncState();
    expect(state).toEqual({ token: 'a-real-token', userId: 'u1', cursor: 'T1', joined: true });
  });

  it('says the password was refused, and keeps what was typed', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ failed: true, kind: 'unauthorized', status: 401, detail: null });
    render(<SignInScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    typeInto('Email', 'gabriel@example.com');
    typeInto('Password', 'wrong');
    clickButton('Sign in');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.getByRole('alert').textContent).toMatch(/email or password/i);
    // Clearing the form on a wrong password means typing the email again for
    // nothing, on a phone.
    const emailInput = screen.getByLabelText('Email');
    if (!(emailInput instanceof HTMLInputElement)) {
      throw new Error('expected an email input');
    }
    expect(emailInput.value).toBe('gabriel@example.com');
    const passwordInput = screen.getByLabelText('Password');
    if (!(passwordInput instanceof HTMLInputElement)) {
      throw new Error('expected a password input');
    }
    expect(passwordInput.value).toBe('wrong');
  });

  it('tells the owner the door is shut, not that the server is broken', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ failed: true, kind: 'refused', status: 429, detail: null });
    render(<SignInScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    typeInto('Email', 'gabriel@example.com');
    typeInto('Password', 'the-right-one');
    clickButton('Sign in');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // 429 is the attempts limit. The password may well be correct; saying
    // "something went wrong" would send the owner to debug his own memory.
    expect(screen.getByRole('alert').textContent).toMatch(/too many attempts|try again in/i);
  });

  it('says nothing answered when there is no network', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ failed: true, kind: 'offline', status: null, detail: null });
    render(<SignInScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    typeInto('Email', 'gabriel@example.com');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.getByRole('alert').textContent).toMatch(/no answer|connection/i);
  });

  it('does not send a second request while the first is in the air', async () => {
    let release: (value: { token: string; userId: string }) => void = () => {};
    const login = vi.spyOn(apiClient, 'login').mockReturnValue(new Promise((resolve) => { release = resolve; }));
    render(<SignInScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    typeInto('Email', 'gabriel@example.com');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');

    // Five wrong-looking taps on a slow connection is five attempts against a
    // limit of five. The button says so while the request flies...
    const submitButton = screen.getByRole('button', { name: /signing in|sign in/i });
    if (!(submitButton instanceof HTMLButtonElement)) {
      throw new Error('expected a submit button');
    }
    expect(submitButton.disabled).toBe(true);
    // ...and a submit that does not come through the button (Enter in a field,
    // a form submit from anywhere) is stopped by the handler itself.
    fireEvent.submit(screen.getByRole('form'));
    expect(login).toHaveBeenCalledTimes(1);
    release({ token: 'a-real-token', userId: 'u1' });
  });

  it('does not mark a device as joined just because it signed in', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token', userId: 'u1' });
    render(<SignInScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    typeInto('Email', 'gabriel@example.com');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await vi.waitFor(async () => expect((await repository.readSyncState()).token).toBe('a-real-token'));

    // A fresh device has never answered the first-sync question. Writing
    // `joined: true` here would skip it, and the engine would start merging
    // before the owner chose what to keep.
    expect(await repository.readSyncState()).toEqual({ token: 'a-real-token', userId: 'u1', cursor: null, joined: false });
  });

  it('asks before a session for another account takes a device with unsent changes', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token', userId: 'u2' });
    await repository.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    await repository.savePlan({ ...plan, id: 'theirs' });
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} onSwitch={vi.fn()} />);

    typeInto('Email', 'someone@example.com');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await vi.waitFor(() => expect(screen.getByText(/another account/i)).toBeTruthy());

    // The hole this plan closes: this screen used to write the token here, and
    // the next round sent u1's change to u2's cloud.
    expect(screen.getByText(/1 change made here has not reached/i)).toBeTruthy();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(await repository.readSyncState()).toEqual({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    expect((await repository.listPlans()).map((row) => row.id)).toEqual(['theirs']);
  });

  it("removes the other account's rows, keeps a copy, and signs in when told to", async () => {
    vi.useFakeTimers();
    vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token', userId: 'u2' });
    await repository.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    await repository.savePlan({ ...plan, id: 'theirs' });
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} onSwitch={vi.fn()} />);

    typeInto('Email', 'someone@example.com');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRM_ARMS_AFTER_MS);
    });
    clickButton(/remove and continue/i);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(await repository.readSyncState()).toEqual({ token: 'a-real-token', userId: 'u2', cursor: null, joined: false });
    expect(await repository.listPlans()).toEqual([]);
    expect(Object.keys(localStorage).some((key) => key.startsWith('nowline.discarded.'))).toBe(true);
  });

  it('gives the form back on Cancel, and asks the server to forget the unused token', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token', userId: 'u2' });
    const logout = vi.spyOn(apiClient, 'logout').mockResolvedValue(true);
    await repository.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    await repository.savePlan({ ...plan, id: 'theirs' });
    render(<SignInScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    typeInto('Email', 'someone@example.com');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: /cancel/i })).toBeTruthy());
    clickButton(/cancel/i);

    // A session nobody adopted should not stay alive on the server.
    expect(logout).toHaveBeenCalledWith('a-real-token');
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(await repository.readSyncState()).toEqual({ token: null, userId: 'u1', cursor: 'T1', joined: true });
  });

  it('says so, and reports it, when the device could not be prepared', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token', userId: 'u1' });
    vi.spyOn(sync, 'adoptSession').mockRejectedValue(new Error('quota exceeded'));
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} onSwitch={vi.fn()} />);

    typeInto('Email', 'gabriel@example.com');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.getByRole('alert').textContent).toMatch(/could not be prepared/i);
    expect(reported).toHaveBeenCalledWith('Preparing this device for the session failed', expect.any(Error));
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('signs in with the email that was typed', async () => {
    const login = vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token', userId: 'u1' });
    render(<SignInScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    typeInto('Email', 'gabriel@example.com');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');

    await vi.waitFor(() => expect(login).toHaveBeenCalledWith('gabriel@example.com', 'a-long-enough-password'));
  });

  it('leaves the address to the server, not to the browser', () => {
    render(<SignInScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    const form = screen.getByRole('form', { name: 'Sign in' });
    if (!(form instanceof HTMLFormElement)) throw new Error('expected a form');
    expect(form.noValidate).toBe(true);
  });

  it('offers the two other ways in', () => {
    const onSwitch = vi.fn();
    render(<SignInScreen onSignedIn={vi.fn()} onSwitch={onSwitch} />);

    clickButton('Create account');
    expect(onSwitch).toHaveBeenLastCalledWith('create');

    clickButton('Forgot password?');
    expect(onSwitch).toHaveBeenLastCalledWith('forgot');
  });
});
