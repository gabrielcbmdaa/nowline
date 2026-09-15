import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  checkEmail,
  checkPassword,
  normalizeEmail,
  refusalFor,
} from './accounts.js';

describe('normalizeEmail', () => {
  it('trims and lowercases, so one mailbox is one account', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com');
  });
});

describe('checkEmail', () => {
  it('accepts one @ with something on each side, and asks for nothing more', () => {
    expect(checkEmail('a@b')).toBeNull();
  });

  it('refuses a second @', () => {
    expect(checkEmail('a@b@c')).toBe('invalid email');
  });

  it('refuses nothing before the @, nothing after it, and nothing at all', () => {
    expect(checkEmail('@b')).toBe('invalid email');
    expect(checkEmail('a@')).toBe('invalid email');
    expect(checkEmail('')).toBe('invalid email');
  });

  it('refuses whitespace anywhere, since normalizeEmail only strips the ends', () => {
    expect(checkEmail(' a@b ')).toBe('invalid email');
    expect(checkEmail('a b@c')).toBe('invalid email');
  });

  it('allows 254 characters and refuses 255', () => {
    const local = 'a'.repeat(254 - '@example.com'.length);
    expect(checkEmail(`${local}@example.com`)).toBeNull();
    expect(checkEmail(`${local}a@example.com`)).toBe('invalid email');
  });
});

describe('checkPassword', () => {
  it('refuses 11 characters and accepts 12, the number the create-user script used', () => {
    expect(checkPassword('a'.repeat(11))).toBe('password too short');
    expect(checkPassword('a'.repeat(12))).toBeNull();
    expect(MIN_PASSWORD_LENGTH).toBe(12);
  });

  it('accepts 72 bytes and refuses 73, because bcrypt hashes only the first 72', () => {
    expect(checkPassword('a'.repeat(72))).toBeNull();
    expect(checkPassword('a'.repeat(73))).toBe('password too long');
  });

  it('counts bytes, not characters: 37 ñ are 74 bytes', () => {
    expect(checkPassword('ñ'.repeat(37))).toBe('password too long');
  });
});

describe('refusalFor', () => {
  it('names the minimum only when the password was too short', () => {
    expect(refusalFor('password too short')).toEqual({ error: 'password too short', minimum: 12 });
    expect(refusalFor('password too long')).toEqual({ error: 'password too long' });
  });
});
