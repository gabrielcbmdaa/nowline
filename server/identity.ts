import { createHash, randomBytes } from 'node:crypto';
import type { Db } from 'mongodb';
import { collections } from './db.js';

/**
 * The only place that knows what a token is. Routes ask "who is this?" and
 * never see inside, so swapping this for signed tokens one day is this file
 * and little else — which is the door the design deliberately left open.
 */

const BYTES = 32;

function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueToken(db: Db, userId: string): Promise<string> {
  const token = randomBytes(BYTES).toString('hex');
  await collections(db).sessions.insertOne({
    tokenHash: fingerprint(token),
    userId,
    createdAt: new Date(),
  });
  // The caller gets the only copy in the clear. Storage keeps the fingerprint,
  // so a leaked database hands out no working keys.
  return token;
}

export async function identify(db: Db, authorization: string | undefined): Promise<string | null> {
  const token = readBearer(authorization);
  if (!token) return null;
  const hash = fingerprint(token);
  const session = await collections(db).sessions.findOne({ tokenHash: hash });
  // findOne already matched on tokenHash — that is the check.
  if (!session) return null;
  return session.userId;
}

export async function revokeToken(db: Db, token: string): Promise<void> {
  await collections(db).sessions.deleteOne({ tokenHash: fingerprint(token) });
}

function readBearer(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const [scheme, value] = authorization.split(' ');
  if (scheme !== 'Bearer' || !value) return null;
  return value;
}
