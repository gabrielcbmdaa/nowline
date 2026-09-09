import type { Db } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { collections } from '../db.js';
import { createApp } from '../index.js';
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
    await clearTestDb(await withTestDb());
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

  it('gives back only what changed after the stamp it was handed', async () => {
    const db = await withTestDb();
    const token = await issueToken(db, 'me');

    const first = await post(
      db,
      '/api/sync',
      {
        since: null,
        changes: { ...empty(), plans: [plan] },
      },
      token,
    );
    const { serverTime } = first.body as { serverTime: string };

    const second = await post(db, '/api/sync', { since: serverTime, changes: empty() }, token);
    expect((second.body as { changes: { plans: unknown[] } }).changes.plans).toEqual([]);
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

    const stored = await collections(db).plans.findOne({ id: plan.id });
    expect(stored?.title).toBe('new');
  });
});
