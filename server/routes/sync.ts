import { Router } from 'express';
import type { Db } from 'mongodb';
import { collections } from '../db.js';
import { identify } from '../identity.js';
import { wins } from '../merge.js';

const KINDS = ['projects', 'plans', 'overrides'] as const;
type Kind = (typeof KINDS)[number];
type Row = { id: string; updatedAt: string };

export function syncRoute(db: Db): Router {
  const router = Router();

  router.post('/api/sync', async (request, response) => {
    const authorization = request.headers.authorization;
    const userId = await identify(db, authorization);
    if (!userId) {
      response.status(401).json({ error: 'invalid credentials' });
      return;
    }

    // One instant for the whole request. Stamped per row, two rows of the
    // same upload could fall on opposite sides of a later cursor, and the
    // other device would fetch half of it and never learn about the rest.
    const serverTime = new Date().toISOString();
    const since = typeof request.body?.since === 'string' ? request.body.since : null;
    const incoming = request.body?.changes ?? {};

    for (const kind of KINDS) {
      const arriving: Row[] = Array.isArray(incoming[kind]) ? incoming[kind] : [];
      const store = collections(db)[kind];

      for (const row of arriving) {
        if (typeof row?.id !== 'string' || typeof row?.updatedAt !== 'string') continue;

        const stored = (await store.findOne({ userId, id: row.id })) as Row | null;
        if (!wins(row, stored)) continue;

        // userId after the spread, so a body that claims another owner is
        // simply overwritten rather than trusted.
        await store.replaceOne(
          { userId, id: row.id },
          { ...row, userId, serverUpdatedAt: serverTime },
          { upsert: true },
        );
      }
    }

    const changes: Record<Kind, unknown[]> = { projects: [], plans: [], overrides: [] };
    for (const kind of KINDS) {
      const filter = since ? { userId, serverUpdatedAt: { $gt: since } } : { userId };
      changes[kind] = await collections(db)[kind]
        .find(filter, { projection: { _id: 0 } })
        .toArray();
    }

    response.json({ serverTime, changes });
  });

  return router;
}
