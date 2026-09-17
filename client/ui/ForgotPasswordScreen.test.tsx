// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../storage/apiClient';
import { ForgotPasswordScreen, RESET_REQUESTED } from './ForgotPasswordScreen';

function ask(email: string): void {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.click(screen.getByRole('button', { name: 'Send link' }));
}

describe('ForgotPasswordScreen', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('asks for a link for the typed address, and answers with one line that does not depend on it', async () => {
    const requestReset = vi.spyOn(apiClient, 'requestReset').mockResolvedValue(true);
    render(<ForgotPasswordScreen onSwitch={vi.fn()} />);

    ask('ana@example.com');
    await vi.waitFor(() => expect(screen.getByRole('status')).toBeTruthy());

    expect(requestReset).toHaveBeenCalledWith('ana@example.com');
    // The server answers the same for every address. Echoing the address, or
    // wording the line differently, is how a screen would undo that.
    expect(screen.getByRole('status').textContent).toBe(RESET_REQUESTED);
    expect(document.body.textContent).not.toContain('ana@example.com');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send link' })).toBeNull();
  });

  it('says nothing answered when there is no network, and keeps the form', async () => {
    vi.spyOn(apiClient, 'requestReset').mockResolvedValue({ failed: true, kind: 'offline', status: null, detail: null });
    render(<ForgotPasswordScreen onSwitch={vi.fn()} />);

    ask('ana@example.com');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    // Nothing was asked of the server, so "a link is on its way" would be a lie.
    expect(screen.getByRole('alert').textContent).toBe('No answer from the server. Check your connection.');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send link' })).toBeTruthy();
  });

  it('says the door is shut after too many requests', async () => {
    vi.spyOn(apiClient, 'requestReset').mockResolvedValue({
      failed: true,
      kind: 'refused',
      status: 429,
      detail: { error: 'too many attempts' },
    });
    render(<ForgotPasswordScreen onSwitch={vi.fn()} />);

    ask('ana@example.com');
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    expect(screen.getByRole('alert').textContent).toBe('Too many attempts. Try again in a few minutes.');
  });

  it('does not send a second request while the first is in the air', () => {
    const requestReset = vi.spyOn(apiClient, 'requestReset').mockReturnValue(new Promise<true>(() => {}));
    render(<ForgotPasswordScreen onSwitch={vi.fn()} />);

    ask('ana@example.com');
    fireEvent.submit(screen.getByRole('form'));

    expect(requestReset).toHaveBeenCalledTimes(1);
    const button = screen.getByRole('button', { name: 'Sending' });
    if (!(button instanceof HTMLButtonElement)) throw new Error('expected a button');
    expect(button.disabled).toBe(true);
  });

  it('goes back to signing in, before and after sending', async () => {
    vi.spyOn(apiClient, 'requestReset').mockResolvedValue(true);
    const onSwitch = vi.fn();
    render(<ForgotPasswordScreen onSwitch={onSwitch} />);

    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onSwitch).toHaveBeenLastCalledWith('sign-in');

    ask('ana@example.com');
    await vi.waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onSwitch).toHaveBeenCalledTimes(2);
    expect(onSwitch).toHaveBeenLastCalledWith('sign-in');
  });

  it('leaves the address to the server, not to the browser', () => {
    render(<ForgotPasswordScreen onSwitch={vi.fn()} />);

    // Pinned on each form: a pin on another screen cannot fail when this
    // one loses the attribute.
    const form = screen.getByRole('form', { name: 'Forgot password' });
    if (!(form instanceof HTMLFormElement)) throw new Error('expected a form');
    expect(form.noValidate).toBe(true);
  });
});
