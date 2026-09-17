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
import { CreateAccountScreen } from './CreateAccountScreen';
import { CONFIRM_ARMS_AFTER_MS } from './FirstSyncScreen';

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

const created = { token: 'new-token', userId: 'u-new', confirmationSent: true };

function typeInto(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillAndSubmit(): void {
  typeInto('Email', 'ana@example.com');
  typeInto('Password', 'a-long-enough-password');
  fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

function typed(label: string): string {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLInputElement)) throw new Error('expected an input');
  return element.value;
}

describe('CreateAccountScreen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('creates the account with what was typed, and signs this device in', async () => {
    const register = vi.spyOn(apiClient, 'register').mockResolvedValue(created);
    const onSignedIn = vi.fn();
    render(<CreateAccountScreen onSignedIn={onSignedIn} onSwitch={vi.fn()} />);

    fillAndSubmit();
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));

    expect(register).toHaveBeenCalledWith('ana@example.com', 'a-long-enough-password');
    // Through the engine, like every session: the screen never writes it.
    expect(await repository.readSyncState()).toEqual({ token: 'new-token', userId: 'u-new', cursor: null, joined: false });
  });

  it('says where password recovery goes before the account exists', () => {
    render(<CreateAccountScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    expect(screen.getByText('Password recovery goes to this address, so make sure it is yours.')).toBeTruthy();
  });

  it("shows the server's refusal with the minimum it asked for, and keeps what was typed", async () => {
    vi.spyOn(apiClient, 'register').mockResolvedValue({
      failed: true,
      kind: 'refused',
      status: 400,
      detail: { error: 'password too short', minimum: 12 },
    });
    const onSignedIn = vi.fn();
    render(<CreateAccountScreen onSignedIn={onSignedIn} onSwitch={vi.fn()} />);

    fillAndSubmit();
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.getByRole('alert').textContent).toBe('Use at least 12 characters.');
    // Both fields, as on the sign-in form: a refusal is not a reason to retype.
    expect(typed('Email')).toBe('ana@example.com');
    expect(typed('Password')).toBe('a-long-enough-password');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('says so when the address already has an account, and keeps it as typed', async () => {
    vi.spyOn(apiClient, 'register').mockResolvedValue({
      failed: true,
      kind: 'refused',
      status: 409,
      detail: { error: 'email taken' },
    });
    render(<CreateAccountScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    // The server normalizes; the screen sends and keeps what was typed.
    typeInto('Email', ' Ana@Example.com ');
    typeInto('Password', 'a-long-enough-password');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.getByRole('alert').textContent).toBe('That email already has an account.');
    expect(apiClient.register).toHaveBeenCalledWith('Ana@Example.com', 'a-long-enough-password');
    expect(typed('Email')).toBe('Ana@Example.com');
    expect(typed('Password')).toBe('a-long-enough-password');
  });

  it('says nothing answered when there is no network', async () => {
    vi.spyOn(apiClient, 'register').mockResolvedValue({ failed: true, kind: 'offline', status: null, detail: null });
    render(<CreateAccountScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    fillAndSubmit();
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.getByRole('alert').textContent).toMatch(/no answer|connection/i);
  });

  it('leaves the address to the server, not to the browser', () => {
    render(<CreateAccountScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    // type="email" is kept for the phone's keyboard. Without noValidate the
    // browser would refuse "ana" before the server saw it, in its own words,
    // and the sentence for `invalid email` could never be read.
    const form = screen.getByRole('form', { name: 'Create account' });
    if (!(form instanceof HTMLFormElement)) throw new Error('expected a form');
    expect(form.noValidate).toBe(true);
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe('username');
  });

  it('does not send a second request while the first is in the air', () => {
    const register = vi.spyOn(apiClient, 'register').mockReturnValue(new Promise<apiClient.Registered>(() => {}));
    render(<CreateAccountScreen onSignedIn={vi.fn()} onSwitch={vi.fn()} />);

    fillAndSubmit();
    // A second account attempt is a second registration against a limit of five an hour.
    fireEvent.submit(screen.getByRole('form'));

    expect(register).toHaveBeenCalledTimes(1);
    const button = screen.getByRole('button', { name: 'Creating account' });
    if (!(button instanceof HTMLButtonElement)) throw new Error('expected a button');
    expect(button.disabled).toBe(true);
  });

  it('goes back to signing in on request', () => {
    const onSwitch = vi.fn();
    render(<CreateAccountScreen onSignedIn={vi.fn()} onSwitch={onSwitch} />);

    fireEvent.click(screen.getByRole('button', { name: 'Sign in instead' }));

    expect(onSwitch).toHaveBeenCalledWith('sign-in');
  });

  it('asks before a new account takes a device that holds another account’s unsent changes', async () => {
    vi.useFakeTimers();
    vi.spyOn(apiClient, 'register').mockResolvedValue(created);
    await repository.writeSyncState({ token: null, userId: 'u1', cursor: 'T1', joined: true });
    await repository.savePlan({ ...plan, id: 'theirs' });
    const onSignedIn = vi.fn();
    render(<CreateAccountScreen onSignedIn={onSignedIn} onSwitch={vi.fn()} />);

    fillAndSubmit();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The same question signing in asks: the new account must not inherit u1's change.
    expect(screen.getByText(/1 change made here has not reached/i)).toBeTruthy();
    expect(onSignedIn).not.toHaveBeenCalled();
    expect(await repository.readSyncState()).toEqual({ token: null, userId: 'u1', cursor: 'T1', joined: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRM_ARMS_AFTER_MS);
    });
    fireEvent.click(screen.getByRole('button', { name: /remove and continue/i }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(await repository.readSyncState()).toEqual({ token: 'new-token', userId: 'u-new', cursor: null, joined: false });
    expect(await repository.listPlans()).toEqual([]);
  });
});
