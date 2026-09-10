import { randomBytes } from 'node:crypto';
import type { Db } from 'mongodb';
import { Router } from 'express';
import { collections } from '../db.js';
import { issueToken } from '../identity.js';
import { hashPassword, verifyPassword } from '../passwords.js';

// One answer for every failure. Telling a stranger which usernames exist is
// telling them where to spend their guesses.
const REFUSED = { error: 'invalid credentials' };

// Renamed from MAX_FAILURES on purpose: the counter now goes up when an
// attempt starts, not when one is known to have failed. A success wipes the
// row, so the number only ever grows on guesses that did not get in.
export const MAX_ATTEMPTS = 5;
export const WINDOW_MINUTES = 15;

// bcrypt runs even when the username does not exist, so the two refusals take
// the same time as well as saying the same thing. Made once per process, out
// of bytes nobody knows.
const dummyHash = hashPassword(randomBytes(32).toString('hex'));

/**
 * One operation, because a check followed by an increment is not a limit:
 * twelve guesses fired together all read "under the limit" before any of them
 * wrote, and all twelve got their bcrypt comparison. `$inc` is atomic; the
 * `if` that used to precede it was not.
 */
async function countAttempt(db: Db, key: string): Promise<number> {
  const cutoff = new Date(Date.now() - WINDOW_MINUTES * 60_000);
  await collections(db).loginAttempts.deleteOne({ key, firstFailureAt: { $lt: cutoff } });

  const row = await collections(db).loginAttempts.findOneAndUpdate(
    { key },
    { $inc: { attempts: 1 }, $setOnInsert: { firstFailureAt: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );
  return row?.attempts ?? 1;
}

export function loginRoute(db: Db): Router {
  const router = Router();

  router.post('/api/auth/login', async (request, response) => {
    const body = request.body as { username?: unknown; password?: unknown } | null | undefined;
    const username = body?.username;
    const password = body?.password;
    if (typeof username !== 'string' || typeof password !== 'string') {
      response.status(401).json(REFUSED);
      return;
    }

    if ((await countAttempt(db, username)) > MAX_ATTEMPTS) {
      response.status(429).json({ error: 'too many attempts' });
      return;
    }

    const user = await collections(db).users.findOne({ username });
    const ok = await verifyPassword(password, user ? user.passwordHash : await dummyHash);
    if (!user || !ok) {
      response.status(401).json(REFUSED);
      return;
    }

    await collections(db).loginAttempts.deleteOne({ key: username });
    response.json({ token: await issueToken(db, String(user._id)) });
  });

  return router;
}
