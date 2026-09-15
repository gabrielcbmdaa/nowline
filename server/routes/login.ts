import { randomBytes } from 'node:crypto';
import type { Db } from 'mongodb';
import { Router } from 'express';
import { normalizeEmail } from '../accounts.js';
import { LIMITS, TOO_MANY, countAttempt, forgetAttempts, ipOf } from '../attempts.js';
import { collections } from '../db.js';
import { issueToken } from '../identity.js';
import { hashPassword, verifyPassword } from '../passwords.js';

// One answer for every failure. Telling a stranger which addresses have an
// account is telling them where to spend their guesses.
const REFUSED = { error: 'invalid credentials' };

// bcrypt runs even when the address does not exist, so the two refusals take
// the same time as well as saying the same thing. Made once per process, out
// of bytes nobody knows.
const dummyHash = hashPassword(randomBytes(32).toString('hex'));

export function loginRoute(db: Db): Router {
  const router = Router();

  router.post('/api/auth/login', async (request, response) => {
    const body = request.body as { email?: unknown; password?: unknown } | null | undefined;
    const rawEmail = body?.email;
    const password = body?.password;
    if (typeof rawEmail !== 'string' || typeof password !== 'string') {
      response.status(401).json(REFUSED);
      return;
    }
    const email = normalizeEmail(rawEmail);

    // Both counted on every attempt, whatever the other says: a guess that one
    // wall refuses still has to count against the other.
    const overByEmail = await countAttempt(db, `login:${email}`, LIMITS.login);
    const overByIp = await countAttempt(db, `login-ip:${ipOf(request)}`, LIMITS.loginIp);
    if (overByEmail || overByIp) {
      response.status(429).json(TOO_MANY);
      return;
    }

    const user = await collections(db).users.findOne({ email });
    const ok = await verifyPassword(password, user ? user.passwordHash : await dummyHash);
    if (!user || !ok) {
      response.status(401).json(REFUSED);
      return;
    }

    // Only the address's own lock lifts. The IP's keeps counting, or one right
    // password would reopen the wall for every other address it is guessing at.
    await forgetAttempts(db, `login:${email}`);
    // The account travels with its token. A device records the two together,
    // and that pair is how it later tells its own rows from somebody else's.
    const userId = String(user._id);
    response.json({ token: await issueToken(db, userId), userId });
  });

  return router;
}
