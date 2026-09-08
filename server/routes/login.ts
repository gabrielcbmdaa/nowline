import type { Db } from 'mongodb';
import { Router } from 'express';
import { collections } from '../db.js';
import { issueToken } from '../identity.js';
import { verifyPassword } from '../passwords.js';

// One answer for every failure. Telling a stranger which usernames exist is
// telling them where to spend their guesses.
const REFUSED = { error: 'invalid credentials' };

export function loginRoute(db: Db): Router {
  const router = Router();

  router.post('/api/auth/login', async (request, response) => {
    const { username, password } = request.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string') {
      response.status(401).json(REFUSED);
      return;
    }

    const user = await collections(db).users.findOne({ username });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      response.status(401).json(REFUSED);
      return;
    }

    response.json({ token: await issueToken(db, String(user._id)) });
  });

  return router;
}
