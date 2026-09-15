import type { Db } from 'mongodb';
import { collections } from '../db.js';
import { hashPassword } from '../passwords.js';

export type UserSeed = {
  email: string | null;
  password: string;
  verifiedAt?: Date | null;
  createdAt?: Date;
};

/**
 * A row the way `register` stores one, without going through the route: the
 * tests of everything else need an account to exist first. The email is
 * stored as given — a test that wants it normalized passes it normalized.
 */
export async function insertUser(db: Db, seed: UserSeed): Promise<{ userId: string }> {
  const { insertedId } = await collections(db).users.insertOne({
    email: seed.email,
    passwordHash: await hashPassword(seed.password),
    verifiedAt: seed.verifiedAt ?? null,
    createdAt: seed.createdAt ?? new Date(),
  });
  return { userId: String(insertedId) };
}
