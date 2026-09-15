import type { Db } from 'mongodb';
import { Router } from 'express';
import { revokeSession } from '../identity.js';

/**
 * What a signed-in device asks about its own session. Today only "forget it";
 * the account tab adds "who am I" in a later plan.
 */
export function sessionRoute(db: Db): Router {
  const router = Router();

  // 204 whatever the header held: this device's session, a dead one, or none.
  router.post('/api/auth/logout', async (request, response) => {
    await revokeSession(db, request.headers.authorization);
    response.status(204).end();
  });

  return router;
}
