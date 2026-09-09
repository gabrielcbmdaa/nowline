import { Router } from 'express';
import type { Collection, Db, Document } from 'mongodb';
import { collections } from '../db.js';
import { identify } from '../identity.js';

const KINDS = ['projects', 'plans', 'overrides'] as const;
type Kind = (typeof KINDS)[number];
// The two fields the server reads, plus whatever else the client stores on the
// row: it is kept whole and handed back untouched, so the server does not need
// to know the shape of a plan to store one.
type Row = { id: string; updatedAt: string; [field: string]: unknown };

function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/**
 * Store one row, keeping whichever copy carries the newer device stamp.
 *
 * Exported because that promise is what the tests have to be able to break.
 * It is also why the comparison lives in the filter: a read, a comparison and
 * a write are three steps with two gaps, and two overlapping uploads of the
 * same id both read the old copy, both conclude they win, and the slower one
 * lands last — which is how the OLDER updatedAt used to be kept. Mongo has no
 * transactions on a standalone node, so one operation is the only atomic unit
 * there is.
 */
export async function saveRow(
  store: Collection<Document>,
  userId: string,
  row: Row,
  stamp: string,
): Promise<void> {
  // userId goes in the filter and in the document, so a body claiming another
  // owner is overwritten rather than trusted.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await store.updateOne(
        { userId, id: row.id, updatedAt: { $lt: row.updatedAt } },
        { $set: { ...row, userId, serverUpdatedAt: stamp } },
        { upsert: true },
      );
      return;
    } catch (error: unknown) {
      // No match plus upsert means "insert", and the unique index turns that
      // into a duplicate-key error whenever a row is already there — either one
      // the filter did not match because it is newer (right answer: leave it),
      // or one another request inserted a moment ago (right answer: try once
      // more, now that it is visible).
      if (!isDuplicateKey(error)) throw error;
    }
  }
}

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

        await saveRow(store, userId, row, serverTime);
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
