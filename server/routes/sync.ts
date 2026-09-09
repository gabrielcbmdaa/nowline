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

    const since = typeof request.body?.since === 'string' ? request.body.since : null;
    const incoming = request.body?.changes ?? {};

    // A row the server dropped has to be named. The client empties its pending
    // queue when it gets a correct answer, so a silent skip inside a 200 is an
    // id that leaves the queue and never reaches the server.
    const rejected: string[] = [];

    for (const kind of KINDS) {
      const arriving: Row[] = Array.isArray(incoming[kind]) ? incoming[kind] : [];
      const store = collections(db)[kind];

      for (const row of arriving) {
        if (typeof row?.updatedAt !== 'string') {
          if (typeof row?.id === 'string') rejected.push(row.id);
          continue;
        }
        if (typeof row?.id !== 'string') continue;

        // Stamped when the row is written, which is what the spec says: the
        // server stamps a row "when it saves it". A stamp taken at the top of
        // the request can be older than a row another request has already
        // stored, and a cursor built from it would step over that row.
        await saveRow(store, userId, row, new Date().toISOString());
      }
    }

    const changes: Record<Kind, unknown[]> = { projects: [], plans: [], overrides: [] };

    // The cursor is the newest stamp actually handed over, never the wall
    // clock. A clock cursor can run ahead of a row another request is still
    // writing, and `$gt` would then skip that row for good. `$gte` re-sends
    // the row sitting exactly on the boundary; that costs one row per round
    // and is why nothing is lost.
    let cursor = since ?? '';
    for (const kind of KINDS) {
      const filter = since ? { userId, serverUpdatedAt: { $gte: since } } : { userId };
      const rows = await collections(db)[kind].find(filter, { projection: { _id: 0 } }).toArray();
      changes[kind] = rows;
      for (const row of rows) {
        const stamp = (row as { serverUpdatedAt?: unknown }).serverUpdatedAt;
        if (typeof stamp === 'string' && stamp > cursor) cursor = stamp;
      }
    }

    response.json({ serverTime: cursor, changes, rejected });
  });

  return router;
}
