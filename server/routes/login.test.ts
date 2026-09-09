import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collections, connect } from '../db.js';
import { createApp } from '../index.js';
import { identify } from '../identity.js';
import { hashPassword } from '../passwords.js';
import { call } from '../testing/http.js';
import { MAX_ATTEMPTS, WINDOW_MINUTES } from './login.js';
import { clearTestDb, closeTestDb, withTestDb } from '../testing/mongo.js';

const post = (db: Db, path: string, body: unknown, token?: string) =>
  call(createApp(db), path, { method: 'POST', body, token });


describe('login', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    const db = await withTestDb();
    await clearTestDb(db);
    await connect(db);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  afterAll(closeTestDb);

  it('hands back a token that then identifies the user', async () => {
    const db = await withTestDb();
    await collections(db).users.insertOne({
      username: 'gabriel',
      passwordHash: await hashPassword('correct horse'),
    });

    const response = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'correct horse',
    });

    expect(response.status).toBe(200);
    const { token } = response.body as { token: string };
    expect(await identify(db, `Bearer ${token}`)).not.toBeNull();
  });

  it('answers the same way to a wrong password and to a user that does not exist', async () => {
    const db = await withTestDb();
    await collections(db).users.insertOne({
      username: 'gabriel',
      passwordHash: await hashPassword('correct horse'),
    });

    const wrongPassword = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'wrong',
    });
    const noSuchUser = await post(db, '/api/auth/login', {
      username: 'nobody',
      password: 'wrong',
    });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(noSuchUser.body);
  });

  it('never sends the hash back', async () => {
    const db = await withTestDb();
    const passwordHash = await hashPassword('correct horse');
    await collections(db).users.insertOne({ username: 'gabriel', passwordHash });

    const response = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'correct horse',
    });

    expect(JSON.stringify(response.body)).not.toContain(passwordHash);
  });

  it('stops answering after several failures in a row', async () => {
    const db = await withTestDb();
    await collections(db).users.insertOne({
      username: 'gabriel',
      passwordHash: await hashPassword('correct horse'),
    });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await post(db, '/api/auth/login', { username: 'gabriel', password: 'wrong' });
    }

    const blocked = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'wrong',
    });
    expect(blocked.status).toBe(429);
  });

  it('blocks the correct password too, once the door is shut', async () => {
    const db = await withTestDb();
    await collections(db).users.insertOne({
      username: 'gabriel',
      passwordHash: await hashPassword('correct horse'),
    });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await post(db, '/api/auth/login', { username: 'gabriel', password: 'wrong' });
    }

    const withRightPassword = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'correct horse',
    });
    expect(withRightPassword.status).toBe(429);
  });

  it('forgets the failures once a successful login gets through', async () => {
    const db = await withTestDb();
    await collections(db).users.insertOne({
      username: 'gabriel',
      passwordHash: await hashPassword('correct horse'),
    });

    const justUnderLimit = MAX_ATTEMPTS - 1;
    for (let attempt = 0; attempt < justUnderLimit; attempt += 1) {
      await post(db, '/api/auth/login', { username: 'gabriel', password: 'wrong' });
    }
    await post(db, '/api/auth/login', { username: 'gabriel', password: 'correct horse' });

    for (let attempt = 0; attempt < justUnderLimit; attempt += 1) {
      await post(db, '/api/auth/login', { username: 'gabriel', password: 'wrong' });
    }
    // Two runs of (MAX_ATTEMPTS - 1) failures would exceed MAX_ATTEMPTS without the clear.
    const stillOpen = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'correct horse',
    });
    expect(stillOpen.status).toBe(200);
  });

  it('reopens after the failure window expires', async () => {
    vi.useFakeTimers();
    const startedAt = new Date(2026, 8, 8, 10, 0, 0);
    vi.setSystemTime(startedAt);

    const db = await withTestDb();
    await collections(db).users.insertOne({
      username: 'gabriel',
      passwordHash: await hashPassword('correct horse'),
    });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await post(db, '/api/auth/login', { username: 'gabriel', password: 'wrong' });
    }
    const blocked = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'correct horse',
    });
    expect(blocked.status).toBe(429);

    vi.setSystemTime(new Date(startedAt.getTime() + (WINDOW_MINUTES + 1) * 60_000));
    const reopened = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'correct horse',
    });
    expect(reopened.status).toBe(200);
  });

  it('stays shut until the failure window expires', async () => {
    vi.useFakeTimers();
    const startedAt = new Date(2026, 8, 8, 10, 0, 0);
    vi.setSystemTime(startedAt);

    const db = await withTestDb();
    await collections(db).users.insertOne({
      username: 'gabriel',
      passwordHash: await hashPassword('correct horse'),
    });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await post(db, '/api/auth/login', { username: 'gabriel', password: 'wrong' });
    }

    vi.setSystemTime(new Date(startedAt.getTime() + (WINDOW_MINUTES - 1) * 60_000));
    const stillShut = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'correct horse',
    });
    expect(stillShut.status).toBe(429);
  });

  it('counts guesses fired at the same time, not only one after another', async () => {
    const db = await withTestDb();
    await collections(db).users.insertOne({
      username: 'gabriel',
      passwordHash: await hashPassword('correct horse'),
    });

    const guesses = Array.from({ length: MAX_ATTEMPTS + 7 }, () =>
      post(db, '/api/auth/login', { username: 'gabriel', password: 'wrong' }),
    );
    const statuses = (await Promise.all(guesses)).map((r) => r.status);

    // Every guess past the limit has to be refused, however they were fired.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(7);
    // And refused on purpose: an upsert racing the unique index throws a
    // duplicate-key error, which would come out of here as a 500.
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
  });

  it('takes as long to refuse a name that does not exist as one that does', async () => {
    const db = await withTestDb();
    await collections(db).users.insertOne({
      username: 'gabriel',
      passwordHash: await hashPassword('correct horse'),
    });

    const time = async (username: string) => {
      const started = performance.now();
      await post(db, '/api/auth/login', { username, password: 'wrong' });
      return performance.now() - started;
    };

    const known = await time('gabriel');
    const unknown = await time('nobody-at-all');

    // A ratio, not a fixed number of milliseconds: the point is that one path
    // does not skip bcrypt entirely. Skipping it measured 4ms against 217ms.
    expect(unknown).toBeGreaterThan(known * 0.5);
  });
});
