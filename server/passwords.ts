import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * bcrypt hashes the first 72 bytes and drops the rest without a word, so a
 * longer password would be stored as a shorter one. Asked before hashing, and
 * answered by the library itself rather than by counting here: the cut is
 * bcrypt's rule, not this file's.
 */
export function truncatesWhenHashed(plain: string): boolean {
  return bcrypt.truncates(plain);
}
