import type { Db } from 'mongodb';
import { Router } from 'express';
import { identify, revokeSession } from '../identity.js';
import { findUserById } from '../users.js';

/**
 * What a signed-in device asks about its own session: "forget it", and
 * "who am I", which the account tab reads.
 */
export function sessionRoute(db: Db): Router {
  const router = Router();

  // 204 whatever the header held: this device's session, a dead one, or none.
  router.post('/api/auth/logout', async (request, response) => {
    await revokeSession(db, request.headers.authorization);
    response.status(204).end();
  });

  router.get('/api/auth/me', async (request, response) => {
    const userId = await identify(db, request.headers.authorization);
    const user = userId === null ? null : await findUserById(db, userId);
    // A session whose account is gone is as dead as no session.
    if (!user) {
      response.status(401).json({ error: 'invalid credentials' });
      return;
    }
    response.json({ userId: String(user._id), email: user.email, verifiedAt: user.verifiedAt });
  });

  return router;
}
