import { randomBytes } from 'node:crypto';
import type { Db } from 'mongodb';
import { Router } from 'express';
import { LIMITS, TOO_MANY, countAttempt, forgetAttempts } from '../attempts.js';
import { collections } from '../db.js';
import { issueToken } from '../identity.js';
import { hashPassword, verifyPassword } from '../passwords.js';

// One answer for every failure. Telling a stranger which usernames exist is
// telling them where to spend their guesses.
const REFUSED = { error: 'invalid credentials' };

// bcrypt runs even when the username does not exist, so the two refusals take
// the same time as well as saying the same thing. Made once per process, out
// of bytes nobody knows.
const dummyHash = hashPassword(randomBytes(32).toString('hex'));

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

    if (await countAttempt(db, `login:${username}`, LIMITS.login)) {
      response.status(429).json(TOO_MANY);
      return;
    }

    const user = await collections(db).users.findOne({ username });
    const ok = await verifyPassword(password, user ? user.passwordHash : await dummyHash);
    if (!user || !ok) {
      response.status(401).json(REFUSED);
      return;
    }

    await forgetAttempts(db, `login:${username}`);
    // The account travels with its token. A device records the two together,
    // and that pair is how it later tells its own rows from somebody else's.
    const userId = String(user._id);
    response.json({ token: await issueToken(db, userId), userId });
  });

  return router;
}
