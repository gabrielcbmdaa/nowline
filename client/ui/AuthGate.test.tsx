// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as apiClient from '../storage/apiClient';
import { AuthGate } from './AuthGate';

function clickButton(name: string): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('AuthGate', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens on signing in, and moves between the three screens and back', () => {
    render(<AuthGate onSignedIn={vi.fn()} />);
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeTruthy();

    clickButton('Create account');
    expect(screen.getByRole('form', { name: 'Create account' })).toBeTruthy();

    clickButton('Sign in instead');
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeTruthy();

    clickButton('Forgot password?');
    expect(screen.getByRole('form', { name: 'Forgot password' })).toBeTruthy();

    clickButton('Back to sign in');
    expect(screen.getByRole('form', { name: 'Sign in' })).toBeTruthy();
  });

  it('passes a finished sign-in, or a new account, up to the app', async () => {
    vi.spyOn(apiClient, 'register').mockResolvedValue({ token: 'new-token', userId: 'u-new', confirmationSent: true });
    const onSignedIn = vi.fn();
    render(<AuthGate onSignedIn={onSignedIn} />);

    clickButton('Create account');
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-enough-password' } });
    clickButton('Create account');

    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it('passes a finished sign-in up to the app too', async () => {
    vi.spyOn(apiClient, 'login').mockResolvedValue({ token: 'a-real-token', userId: 'u1' });
    const onSignedIn = vi.fn();
    render(<AuthGate onSignedIn={onSignedIn} />);

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'a-long-enough-password' } });
    clickButton('Sign in');

    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });
});
