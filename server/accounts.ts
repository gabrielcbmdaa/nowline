import { truncatesWhenHashed } from './passwords.js';

/**
 * What an account asks for, and nothing else: an address that can receive a
 * link, and a password long enough to be expensive to guess. Pure on purpose,
 * the same split `passwords.ts` has, so the rules can be read and tested
 * without a database. Only the server checks any of this — the screen sends
 * what was typed and shows what came back — so each rule has one copy.
 */

/** The number the owner chose for `scripts/create-user.ts`, and from now on its only copy. */
export const MIN_PASSWORD_LENGTH = 12;

/** RFC 5321's limit on a whole address. Longer is not an address anyone can receive at. */
const MAX_EMAIL_LENGTH = 254;

export type EmailProblem = 'invalid email';
export type PasswordProblem = 'password too short' | 'password too long';

/**
 * Every route normalizes before it queries or stores. Mongo's unique index is
 * case-sensitive, so without this `Ana@x` and `ana@x` would be two accounts.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Exactly one `@` with something on each side, no whitespace, at most 254
 * characters — and nothing more, on purpose. "Complete" email patterns reject
 * real addresses, and the real check is that the link arrives.
 */
export function checkEmail(normalized: string): EmailProblem | null {
  const at = normalized.indexOf('@');
  if (at < 1 || at !== normalized.lastIndexOf('@') || at === normalized.length - 1) {
    return 'invalid email';
  }
  if (/\s/.test(normalized) || normalized.length > MAX_EMAIL_LENGTH) return 'invalid email';
  return null;
}

/**
 * Length is what makes a password expensive to break, so length is the only
 * rule. Characters for the minimum, the way the script counted; bytes for the
 * maximum, because that is where bcrypt cuts.
 */
export function checkPassword(plain: string): PasswordProblem | null {
  if (plain.length < MIN_PASSWORD_LENGTH) return 'password too short';
  if (truncatesWhenHashed(plain)) return 'password too long';
  return null;
}

/**
 * The JSON a route answers with. `minimum` travels with "too short" so the
 * screen can print the number without owning a copy of it.
 */
export function refusalFor(problem: PasswordProblem): { error: PasswordProblem; minimum?: number } {
  return problem === 'password too short'
    ? { error: problem, minimum: MIN_PASSWORD_LENGTH }
    : { error: problem };
}
