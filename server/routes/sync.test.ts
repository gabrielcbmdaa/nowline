import type { Db } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { collections, connect } from '../db.js';
import { createApp } from '../index.js';
import { saveRow } from './sync.js';
import { issueToken } from '../identity.js';
import { call } from '../testing/http.js';
import { clearTestDb, closeTestDb, withTestDb } from '../testing/mongo.js';

const post = (db: Db, path: string, body: unknown, token?: string) =>
  call(createApp(db), path, { method: 'POST', body, token });

const empty = () => ({ projects: [], plans: [], overrides: [] });

const plan = {
  id: 'p1',
  title: 'gym',
  projectId: null,
  startMinute: 1080,
  durationMinutes: 60,
  recurrence: 'none',
  anchorDate: '2026-09-08',
  createdAt: '2026-09-08T09:00:00.000Z',
  updatedAt: '2026-09-08T09:00:00.000Z',
  deletedAt: null,
};

describe('sync', () => {
  beforeEach(async () => {
    const db = await withTestDb();
    await clearTestDb(db);
    // clearTestDb drops the collections, and their indexes go with them. The
    // unique { userId, id } index is part of what this route leans on, so every
    // test has to start with the indexes production starts with. Without this,
    // a stale upload inserts a second document and a findOne still finds the
    // right one, which is how these tests once passed for the wrong reason.
    await connect(db);
  });
  afterAll(closeTestDb);

  it('refuses anyone without a valid token', async () => {
    const db = await withTestDb();
    const response = await post(db, '/api/sync', { since: null, changes: empty() });
    expect(response.status).toBe(401);
  });

  it('ignores the userId in the body and uses the one in the token', async () => {
    const db = await withTestDb();
    const token = await issueToken(db, 'the-real-one');

    await post(
      db,
      '/api/sync',
      {
        since: null,
        changes: { ...empty(), plans: [{ ...plan, userId: 'someone-else' }] },
      },
      token,
    );

    const stored = await collections(db).plans.find({}).toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0].userId).toBe('the-real-one');
  });

  it('never hands one owner the rows of another', async () => {
    const db = await withTestDb();
    const mine = await issueToken(db, 'me');
    const theirs = await issueToken(db, 'them');

    await post(db, '/api/sync', { since: null, changes: { ...empty(), plans: [plan] } }, theirs);
    const response = await post(db, '/api/sync', { since: null, changes: empty() }, mine);

    expect((response.body as { changes: { plans: unknown[] } }).changes.plans).toEqual([]);
  });

  it('still hands over a row stamped in the very millisecond of the last cursor', async () => {
    const db = await withTestDb();
    await connect(db);
    const token = await issueToken(db, 'me');

    const first = await post(db, '/api/sync', { since: null, changes: { ...empty(), plans: [plan] } }, token);
    const { serverTime } = first.body as { serverTime: string };

    // What another device's request does when its stamp lands on the same
    // millisecond as this one's cursor. Written straight to Mongo because the
    // point is the stamp, not how it got there.
    await collections(db).plans.insertOne({
      ...plan,
      id: 'same-ms',
      userId: 'me',
      serverUpdatedAt: serverTime,
    });

    const second = await post(db, '/api/sync', { since: serverTime, changes: empty() }, token);
    const ids = (second.body as { changes: { plans: { id: string }[] } }).changes.plans.map((p) => p.id);

    expect(ids).toContain('same-ms');
  });

  it('hands back a cursor that came from the rows, not from the clock', async () => {
    const db = await withTestDb();
    await connect(db);
    const token = await issueToken(db, 'me');

    const response = await post(db, '/api/sync', { since: null, changes: { ...empty(), plans: [plan] } }, token);
    const { serverTime } = response.body as { serverTime: string };
    const stored = await collections(db).plans.findOne({ userId: 'me', id: plan.id });

    expect(serverTime).toBe(stored?.serverUpdatedAt);
  });

  it('does not send the whole collection back on every round', async () => {
    const db = await withTestDb();
    await connect(db);
    const token = await issueToken(db, 'me');

    await post(db, '/api/sync', { since: null, changes: { ...empty(), plans: [plan] } }, token);
    const second = await post(
      db,
      '/api/sync',
      { since: null, changes: { ...empty(), plans: [{ ...plan, id: 'p2' }] } },
      token,
    );
    const { serverTime } = second.body as { serverTime: string };

    const third = await post(db, '/api/sync', { since: serverTime, changes: empty() }, token);
    const ids = (third.body as { changes: { plans: { id: string }[] } }).changes.plans.map((p) => p.id);

    // 'p2' is the boundary row and comes back again — that is the price of
    // never skipping it. 'p1', stamped earlier, must not.
    expect(ids).not.toContain('p1');
  });

  it('gives back the boundary row and nothing older than it', async () => {
    const db = await withTestDb();
    await connect(db);
    const token = await issueToken(db, 'me');

    const first = await post(db, '/api/sync', { since: null, changes: { ...empty(), plans: [plan] } }, token);
    const { serverTime } = first.body as { serverTime: string };

    const second = await post(db, '/api/sync', { since: serverTime, changes: empty() }, token);
    const ids = (second.body as { changes: { plans: { id: string }[] } }).changes.plans.map((p) => p.id);

    expect(ids).toEqual(['p1']);
  });

  it('keeps the newer copy when the same row arrives twice', async () => {
    const db = await withTestDb();
    const token = await issueToken(db, 'me');

    await post(
      db,
      '/api/sync',
      {
        since: null,
        changes: {
          ...empty(),
          plans: [{ ...plan, title: 'old', updatedAt: '2026-09-08T09:00:00.000Z' }],
        },
      },
      token,
    );
    await post(
      db,
      '/api/sync',
      {
        since: null,
        changes: {
          ...empty(),
          plans: [{ ...plan, title: 'new', updatedAt: '2026-09-08T10:00:00.000Z' }],
        },
      },
      token,
    );
    await post(
      db,
      '/api/sync',
      {
        since: null,
        changes: {
          ...empty(),
          plans: [{ ...plan, title: 'stale', updatedAt: '2026-09-08T08:00:00.000Z' }],
        },
      },
      token,
    );

    const stored = await collections(db).plans.find({ userId: 'me', id: plan.id }).toArray();
    expect(stored.map((row) => row.title)).toEqual(['new']);
  });

  it('stamps each row as it is written, not once for the whole request', async () => {
    const db = await withTestDb();
    const token = await issueToken(db, 'me');

    const many = Array.from({ length: 25 }, (_, index) => ({ ...plan, id: `p${index}` }));
    await post(db, '/api/sync', { since: null, changes: { ...empty(), plans: many } }, token);

    const stored = await collections(db).plans.find({ userId: 'me' }).toArray();
    const stamps = stored.map((row) => row.serverUpdatedAt as string);

    // One stamp for the whole request is a stamp taken before most of these
    // rows existed, and the cursor is built from these stamps: a row stamped
    // earlier than a cursor another request already handed out is a row that
    // is never sent again. Twenty-five writes take longer than a millisecond,
    // so a single shared stamp is the only way they all come out equal.
    expect(new Set(stamps).size).toBeGreaterThan(1);
    expect([...stamps]).toEqual([...stamps].sort());
  });

  it('keeps the newer copy when two uploads of the same row overlap', async () => {
    const db = await withTestDb();
    const store = collections(db).plans;
    const ids = Array.from({ length: 25 }, (_, index) => `race-${index}`);
    const row = (id: string, title: string, updatedAt: string) => ({ ...plan, id, title, updatedAt });

    await Promise.all(ids.map((id) => saveRow(store, 'me', row(id, 'stored', '2026-09-08T09:00:00.000Z'), 'T0')));

    // Twenty-five rows rather than one, and a warm connection pool. Both are
    // needed to make this a race at all: the driver's pool starts with a single
    // socket, so a second caller waits for one to be built and by then the
    // first has already written — with one row and a cold pool, a deliberately
    // broken write passed five runs out of five.
    await Promise.all(Array.from({ length: 8 }, () => store.findOne({ userId: 'warm-up' })));

    // Started in the same tick: the phone and the laptop flushing the same
    // block at the same moment. Tested on the write rather than through two
    // HTTP requests, which never reliably meet inside the handler.
    await Promise.all(
      ids.flatMap((id) => [
        saveRow(store, 'me', row(id, 'newer', '2026-09-08T11:00:00.000Z'), 'T1'),
        saveRow(store, 'me', row(id, 'older-but-slow', '2026-09-08T10:00:00.000Z'), 'T2'),
      ]),
    );

    const stored = await store.find({ userId: 'me', id: { $in: ids } }).toArray();
    expect(stored).toHaveLength(ids.length);
    // Named, not counted: a failure says which rows kept the older copy.
    const keptTheOlderCopy = stored.filter((saved) => saved.title !== 'newer').map((saved) => saved.id);
    expect(keptTheOlderCopy).toEqual([]);
  });

  it('refuses to insert a second copy when the stored row is the newer one', async () => {
    const db = await withTestDb();
    const store = collections(db).plans;

    await saveRow(store, 'me', { ...plan, updatedAt: '2026-09-08T11:00:00.000Z' }, 'T0');
    await saveRow(store, 'me', { ...plan, title: 'stale', updatedAt: '2026-09-08T08:00:00.000Z' }, 'T1');

    const stored = await store.find({ userId: 'me', id: plan.id }).toArray();
    expect(stored.map((saved) => saved.title)).toEqual(['gym']);
  });
});
