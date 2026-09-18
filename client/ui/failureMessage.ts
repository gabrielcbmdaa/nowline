import type { ApiFailure } from '../storage/apiClient';

/** What each refusal the server names (design §7) means to the person holding the phone. */
const SENTENCES = new Map<string, string>([
  ['invalid email', 'That does not look like an email address.'],
  ['password too long', 'That password is too long. Use a shorter one.'],
  ['email taken', 'That email already has an account.'],
  ['link expired or used', 'This link has expired or was already used. Ask for a new one.'],
  ['already confirmed', 'This email is already confirmed.'],
  ['no email', 'This account has no email yet.'],
  ['same email', 'That is already your email.'],
  ['wrong password', 'The password is wrong.'],
]);

/** A 200 whose `sent` is false: the provider refused the email and the account is unchanged. */
export const COULD_NOT_SEND = 'The email could not be sent. Try again in a few minutes.';

/**
 * One sentence for a request that did not go through. `unauthorized` is the
 * calling screen's own words for a 401, which means a wrong password on the
 * sign-in form and a dead session everywhere else.
 */
export function failureMessage(failure: ApiFailure, unauthorized?: string): string {
  if (failure.kind === 'offline') return 'No answer from the server. Check your connection.';
  if (failure.kind === 'unauthorized' && unauthorized !== undefined) return unauthorized;
  if (failure.status === 429) return 'Too many attempts. Try again in a few minutes.';

  const code = failure.detail?.error;
  if (code === 'password too short') {
    // The minimum is the server's; a copy here would drift the day it changes.
    const minimum = failure.detail?.minimum;
    return typeof minimum === 'number'
      ? `Use at least ${String(minimum)} characters.`
      : 'That password is too short.';
  }
  const sentence = typeof code === 'string' ? SENTENCES.get(code) : undefined;
  if (sentence !== undefined) return sentence;

  return `The server did not accept the request (${String(failure.status)}).`;
}
