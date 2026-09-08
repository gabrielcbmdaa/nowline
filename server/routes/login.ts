import type { Db } from 'mongodb';
import { Router } from 'express';
import { collections } from '../db.js';
import { issueToken } from '../identity.js';
import { verifyPassword } from '../passwords.js';

// One answer for every failure. Telling a stranger which usernames exist is
// telling them where to spend their guesses.
const REFUSED = { error: 'invalid credentials' };

// Exported so the tests count against the real limit instead of a copy of it:
// a duplicate silently stops discriminating the day this number changes.
export const MAX_FAILURES = 5;
export const WINDOW_MINUTES = 15;

async function isShut(db: Db, key: string): Promise<boolean> {
  const row = await collections(db).loginAttempts.findOne({ key });
  if (!row) return false;

  const minutesOld = (Date.now() - row.firstFailureAt.getTime()) / 60_000;
  if (minutesOld > WINDOW_MINUTES) {
    await collections(db).loginAttempts.deleteOne({ key });
    return false;
  }
  return row.failures >= MAX_FAILURES;
}

async function recordFailure(db: Db, key: string): Promise<void> {
  // upsert so there is no "first time" branch to get wrong.
  await collections(db).loginAttempts.updateOne(
    { key },
    { $inc: { failures: 1 }, $setOnInsert: { firstFailureAt: new Date() } },
    { upsert: true },
  );
}

export function loginRoute(db: Db): Router {
  const router = Router();

  router.post('/api/auth/login', async (request, response) => {
    const { username, password } = request.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      response.status(401).json(REFUSED);
      return;
    }

    if (await isShut(db, username)) {
      response.status(429).json({ error: 'too many attempts' });
      return;
    }

    const user = await collections(db).users.findOne({ username });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      await recordFailure(db, username);
      response.status(401).json(REFUSED);
      return;
    }

    await collections(db).loginAttempts.deleteOne({ key: username });
    response.json({ token: await issueToken(db, String(user._id)) });
  });

  return router;
}
