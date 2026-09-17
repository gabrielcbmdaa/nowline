import { describe, expect, it } from 'vitest';
import type { ApiFailure } from '../storage/apiClient';
import { failureMessage } from './failureMessage';

const refused = (status: number, detail: Record<string, unknown> | null): ApiFailure => ({
  failed: true,
  kind: 'refused',
  status,
  detail,
});

describe('failureMessage', () => {
  it('says nothing answered when there is no network', () => {
    expect(failureMessage({ failed: true, kind: 'offline', status: null, detail: null })).toBe(
      'No answer from the server. Check your connection.',
    );
  });

  it("uses the screen's own words for a 401, and the fallback without them", () => {
    const unauthorized: ApiFailure = {
      failed: true,
      kind: 'unauthorized',
      status: 401,
      detail: { error: 'invalid credentials' },
    };

    // A 401 means something different on each screen: a wrong password on the
    // sign-in form, a dead session everywhere else.
    expect(failureMessage(unauthorized, 'The email or password is wrong.')).toBe('The email or password is wrong.');
    expect(failureMessage(unauthorized)).toBe('The server did not accept the request (401).');
  });

  it('says the door is shut on a 429, whatever the body says', () => {
    expect(failureMessage(refused(429, { error: 'too many attempts' }))).toBe(
      'Too many attempts. Try again in a few minutes.',
    );
  });

  it('reads the minimum length from the server, so the number lives in one place', () => {
    expect(failureMessage(refused(400, { error: 'password too short', minimum: 12 }))).toBe(
      'Use at least 12 characters.',
    );
    expect(failureMessage(refused(400, { error: 'password too short', minimum: 16 }))).toBe(
      'Use at least 16 characters.',
    );
    expect(failureMessage(refused(400, { error: 'password too short' }))).toBe('That password is too short.');
  });

  it.each([
    ['invalid email', 'That does not look like an email address.'],
    ['password too long', 'That password is too long. Use a shorter one.'],
    ['email taken', 'That email already has an account.'],
    ['link expired or used', 'This link has expired or was already used. Ask for a new one.'],
    ['already confirmed', 'This email is already confirmed.'],
    ['no email', 'This account has no email yet.'],
    ['same email', 'That is already your email.'],
    ['wrong password', 'The password is wrong.'],
  ])('names the refusal "%s"', (code, sentence) => {
    expect(failureMessage(refused(400, { error: code }))).toBe(sentence);
  });

  it('falls back to the status for a code it does not know, or for no code at all', () => {
    expect(failureMessage(refused(400, { error: 'bad request' }))).toBe('The server did not accept the request (400).');
    expect(failureMessage(refused(500, null))).toBe('The server did not accept the request (500).');
    // A code that happens to be the name of an object's own method is still unknown.
    expect(failureMessage(refused(400, { error: 'toString' }))).toBe('The server did not accept the request (400).');
  });
});
