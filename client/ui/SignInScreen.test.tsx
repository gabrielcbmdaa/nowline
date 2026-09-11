// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../storage/apiClient';
import { repository } from '../storage/repository';
import { SignInScreen } from './SignInScreen';

function typeInto(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function clickButton(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('SignInScreen', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps the token where the engine looks for it', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token' });
    const onSignedIn = vi.fn();
    render(<SignInScreen onSignedIn={onSignedIn} />);

    typeInto('Username', 'gabriel');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalled());

    // login() hands the token back and stores nothing. Until this screen writes
    // it, every round the engine runs answers `unauthorized`.
    expect((await repository.readSyncState()).token).toBe('a-real-token');
    expect(onSignedIn).toHaveBeenCalled();
  });

  it('does not touch the joined flag when it stores a token', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token' });
    await repository.writeSyncState({ token: null, cursor: 'T1', joined: true });
    render(<SignInScreen onSignedIn={vi.fn()} />);

    typeInto('Username', 'gabriel');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await vi.waitFor(async () => expect((await repository.readSyncState()).token).toBe('a-real-token'));

    // Signing in again after a token expired is not joining again. Writing
    // `joined: false` here would make a device that joined months ago ask the
    // once-in-a-lifetime question a second time, and one of its answers throws
    // away everything written since.
    const state = await repository.readSyncState();
    expect(state).toEqual({ token: 'a-real-token', cursor: 'T1', joined: true });
  });

  it('says the password was refused, and keeps what was typed', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ failed: true, kind: 'unauthorized', status: 401 });
    render(<SignInScreen onSignedIn={vi.fn()} />);

    typeInto('Username', 'gabriel');
    typeInto('Password', 'wrong');
    clickButton('Sign in');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.getByRole('alert').textContent).toMatch(/username or password/i);
    // Clearing the form on a wrong password means typing the username again for
    // nothing, on a phone.
    const usernameInput = screen.getByLabelText('Username');
    if (!(usernameInput instanceof HTMLInputElement)) {
      throw new Error('expected a username input');
    }
    expect(usernameInput.value).toBe('gabriel');
  });

  it('tells the owner the door is shut, not that the server is broken', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ failed: true, kind: 'refused', status: 429 });
    render(<SignInScreen onSignedIn={vi.fn()} />);

    typeInto('Username', 'gabriel');
    typeInto('Password', 'the-right-one');
    clickButton('Sign in');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // 429 is the attempts limit. The password may well be correct; saying
    // "something went wrong" would send the owner to debug his own memory.
    expect(screen.getByRole('alert').textContent).toMatch(/too many attempts|try again in/i);
  });

  it('says nothing answered when there is no network', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ failed: true, kind: 'offline', status: null });
    render(<SignInScreen onSignedIn={vi.fn()} />);

    typeInto('Username', 'gabriel');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.getByRole('alert').textContent).toMatch(/no answer|connection/i);
  });

  it('does not send a second request while the first is in the air', async () => {
    let release: (value: { token: string }) => void = () => {};
    const login = vi.spyOn(apiClient, 'login').mockReturnValue(new Promise((resolve) => { release = resolve; }));
    render(<SignInScreen onSignedIn={vi.fn()} />);

    typeInto('Username', 'gabriel');
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
    release({ token: 'a-real-token' });
  });

  it('does not mark a device as joined just because it signed in', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token' });
    render(<SignInScreen onSignedIn={vi.fn()} />);

    typeInto('Username', 'gabriel');
    typeInto('Password', 'a-long-enough-password');
    clickButton('Sign in');
    await vi.waitFor(async () => expect((await repository.readSyncState()).token).toBe('a-real-token'));

    // A fresh device has never answered the first-sync question. Writing
    // `joined: true` here would skip it, and the engine would start merging
    // before the owner chose what to keep.
    expect(await repository.readSyncState()).toEqual({ token: 'a-real-token', cursor: null, joined: false });
  });
});
