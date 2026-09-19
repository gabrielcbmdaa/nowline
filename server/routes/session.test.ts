import type { Db } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connect } from '../db.js';
import { testApp } from '../testing/app.js';
import { identify, issueToken } from '../identity.js';
import { insertUser } from '../testing/accounts.js';
import { call } from '../testing/http.js';
import { clearTestDb, closeTestDb, withTestDb } from '../testing/mongo.js';

const post = (db: Db, path: string, body: unknown, token?: string) =>
  call(testApp(db), path, { method: 'POST', body, token });

describe('logout', () => {
  beforeEach(async () => {
    const db = await withTestDb();
    await clearTestDb(db);
    await connect(db);
  });
  afterAll(closeTestDb);

  it('forgets the session it was called with, so sync stops accepting it', async () => {
    const db = await withTestDb();
    const token = await issueToken(db, 'u1');

    const response = await post(db, '/api/auth/logout', {}, token);

    expect(response.status).toBe(204);
    expect(await identify(db, `Bearer ${token}`)).toBeNull();
    const round = await post(
      db,
      '/api/sync',
      { since: null, changes: { projects: [], plans: [], overrides: [] } },
      token,
    );
    expect(round.status).toBe(401);
  });

  it("leaves the same account's other devices signed in", async () => {
    const db = await withTestDb();
    const phone = await issueToken(db, 'u1');
    const laptop = await issueToken(db, 'u1');

    await post(db, '/api/auth/logout', {}, phone);

    // Signing one device out is not signing the person out. Only a password
    // reset (revokeAllFor, in routes/recovery.ts) ends every session of an account at once.
    expect(await identify(db, `Bearer ${laptop}`)).toBe('u1');
  });

  it('answers the same to a token it does not know and to no token at all', async () => {
    const db = await withTestDb();

    const unknown = await post(db, '/api/auth/logout', {}, 'not-a-real-token');
    const missing = await post(db, '/api/auth/logout', {});

    // Telling "that was not a live token" apart from "done" would tell a
    // stranger which strings are live tokens.
    expect(unknown.status).toBe(204);
    expect(missing.status).toBe(204);
  });
});

describe('me', () => {
  beforeEach(async () => {
    const db = await withTestDb();
    await clearTestDb(db);
    await connect(db);
  });
  afterAll(closeTestDb);

  it('says who the session is, with the address and whether it is confirmed', async () => {
    const db = await withTestDb();
    const confirmedAt = new Date('2026-09-15T12:00:00.000Z');
    const { userId } = await insertUser(db, {
      email: 'ana@example.com',
      password: 'correct horse battery',
      verifiedAt: confirmedAt,
    });
    const token = await issueToken(db, userId);

    const reply = await call(testApp(db), '/api/auth/me', { token });

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ userId, email: 'ana@example.com', verifiedAt: confirmedAt.toISOString() });
  });

  it('answers 401 without a token, and with a session whose account is gone', async () => {
    const db = await withTestDb();
    const orphan = await issueToken(db, 'no-such-account');

    expect((await call(testApp(db), '/api/auth/me')).status).toBe(401);
    expect((await call(testApp(db), '/api/auth/me', { token: orphan })).status).toBe(401);
  });
});
