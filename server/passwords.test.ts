import { describe, expect, it } from 'vitest';
import { hashPassword, truncatesWhenHashed, verifyPassword } from './passwords.js';

describe('passwords', () => {
  it('verifies a password against its own hash', async () => {
    const plain = 'correct horse battery staple';
    const hash = await hashPassword(plain);

    expect(await verifyPassword(plain, hash)).toBe(true);
  });

  it('rejects a different password', async () => {
    const hash = await hashPassword('one password');

    expect(await verifyPassword('another password', hash)).toBe(false);
  });

  it('does not store the password inside the hash', async () => {
    const plain = 'visible-secret-phrase';
    const hash = await hashPassword(plain);

    expect(hash).not.toContain(plain);
  });

  it('knows when bcrypt would silently keep only the first 72 bytes', () => {
    expect(truncatesWhenHashed('a'.repeat(72))).toBe(false);
    expect(truncatesWhenHashed('a'.repeat(73))).toBe(true);
  });
});
