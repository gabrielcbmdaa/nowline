import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../attempts.js';
import { connect } from '../db.js';
import { testApp } from '../testing/app.js';
import { identify } from '../identity.js';
import { insertUser } from '../testing/accounts.js';
import { call } from '../testing/http.js';
import { clearTestDb, closeTestDb, withTestDb } from '../testing/mongo.js';

const post = (db: Db, path: string, body: unknown, headers?: Record<string, string>) =>
  call(testApp(db), path, { method: 'POST', body, headers });

const gabriel = { email: 'gabriel@example.com', password: 'correct horse' };

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
    await insertUser(db, gabriel);

    const response = await post(db, '/api/auth/login', gabriel);

    expect(response.status).toBe(200);
    const { token } = response.body as { token: string };
    expect(await identify(db, `Bearer ${token}`)).not.toBeNull();
  });

  it('names the account the token belongs to', async () => {
    const db = await withTestDb();
    const { userId: inserted } = await insertUser(db, gabriel);

    const response = await post(db, '/api/auth/login', gabriel);

    const { token, userId } = response.body as { token: string; userId?: unknown };
    expect(userId).toBe(inserted);
    // The device stores the two as one pair, so they must name the same account.
    expect(await identify(db, `Bearer ${token}`)).toBe(userId);
  });

  it('answers the same way to a wrong password and to an address that does not exist', async () => {
    const db = await withTestDb();
    await insertUser(db, gabriel);

    const wrongPassword = await post(db, '/api/auth/login', { email: gabriel.email, password: 'wrong' });
    const noSuchUser = await post(db, '/api/auth/login', { email: 'nobody@example.com', password: 'wrong' });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(noSuchUser.body);
  });

  it('never sends the hash back', async () => {
    const db = await withTestDb();
    await insertUser(db, gabriel);

    const response = await post(db, '/api/auth/login', gabriel);

    expect(JSON.stringify(response.body)).not.toMatch(/\$2[aby]\$/);
  });

  it('stops answering after several failures in a row', async () => {
    const db = await withTestDb();
    await insertUser(db, gabriel);

    for (let attempt = 0; attempt < LIMITS.login.max; attempt += 1) {
      await post(db, '/api/auth/login', { email: gabriel.email, password: 'wrong' });
    }

    const blocked = await post(db, '/api/auth/login', { email: gabriel.email, password: 'wrong' });
    expect(blocked.status).toBe(429);
  });

  it('blocks the correct password too, once the door is shut', async () => {
    const db = await withTestDb();
    await insertUser(db, gabriel);

    for (let attempt = 0; attempt < LIMITS.login.max; attempt += 1) {
      await post(db, '/api/auth/login', { email: gabriel.email, password: 'wrong' });
    }

    const withRightPassword = await post(db, '/api/auth/login', gabriel);
    expect(withRightPassword.status).toBe(429);
  });

  it('forgets the failures once a successful login gets through', async () => {
    const db = await withTestDb();
    await insertUser(db, gabriel);

    const justUnderLimit = LIMITS.login.max - 1;
    for (let attempt = 0; attempt < justUnderLimit; attempt += 1) {
      await post(db, '/api/auth/login', { email: gabriel.email, password: 'wrong' });
    }
    await post(db, '/api/auth/login', gabriel);

    for (let attempt = 0; attempt < justUnderLimit; attempt += 1) {
      await post(db, '/api/auth/login', { email: gabriel.email, password: 'wrong' });
    }
    // Two runs of (max - 1) failures would exceed max without the clear.
    const stillOpen = await post(db, '/api/auth/login', gabriel);
    expect(stillOpen.status).toBe(200);
  });

  it('reopens after the failure window expires', async () => {
    vi.useFakeTimers();
    // In the future on purpose: mongod applies the TTL index against its own clock,
    // and a window stamped in the past can vanish mid-test and reopen the door.
    const startedAt = new Date(2099, 8, 8, 10, 0, 0);
    vi.setSystemTime(startedAt);

    const db = await withTestDb();
    await insertUser(db, gabriel);

    for (let attempt = 0; attempt < LIMITS.login.max; attempt += 1) {
      await post(db, '/api/auth/login', { email: gabriel.email, password: 'wrong' });
    }
    const blocked = await post(db, '/api/auth/login', gabriel);
    expect(blocked.status).toBe(429);

    vi.setSystemTime(new Date(startedAt.getTime() + (LIMITS.login.windowMinutes + 1) * 60_000));
    const reopened = await post(db, '/api/auth/login', gabriel);
    expect(reopened.status).toBe(200);
  });

  it('stays shut until the failure window expires', async () => {
    vi.useFakeTimers();
    // In the future on purpose: mongod applies the TTL index against its own clock,
    // and a window stamped in the past can vanish mid-test and reopen the door.
    const startedAt = new Date(2099, 8, 8, 10, 0, 0);
    vi.setSystemTime(startedAt);

    const db = await withTestDb();
    await insertUser(db, gabriel);

    for (let attempt = 0; attempt < LIMITS.login.max; attempt += 1) {
      await post(db, '/api/auth/login', { email: gabriel.email, password: 'wrong' });
    }

    vi.setSystemTime(new Date(startedAt.getTime() + (LIMITS.login.windowMinutes - 1) * 60_000));
    const stillShut = await post(db, '/api/auth/login', gabriel);
    expect(stillShut.status).toBe(429);
  });

  it('counts guesses fired at the same time, not only one after another', async () => {
    const db = await withTestDb();
    await insertUser(db, gabriel);

    const guesses = Array.from({ length: LIMITS.login.max + 7 }, () =>
      post(db, '/api/auth/login', { email: gabriel.email, password: 'wrong' }),
    );
    const statuses = (await Promise.all(guesses)).map((r) => r.status);

    // Every guess past the limit has to be refused, however they were fired.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(7);
    // And refused on purpose: an upsert racing the unique index throws a
    // duplicate-key error, which would come out of here as a 500.
    expect(statuses.filter((s) => s >= 500)).toEqual([]);
  });

  it('takes as long to refuse an address that does not exist as one that does', async () => {
    const db = await withTestDb();
    await insertUser(db, gabriel);

    const time = async (email: string) => {
      const started = performance.now();
      await post(db, '/api/auth/login', { email, password: 'wrong' });
      return performance.now() - started;
    };

    const known = await time(gabriel.email);
    const unknown = await time('nobody-at-all@example.com');

    // A ratio, not a fixed number of milliseconds: the point is that one path
    // does not skip bcrypt entirely. Skipping it measured 4ms against 217ms.
    expect(unknown).toBeGreaterThan(known * 0.5);
  });

  it('signs in with the address in other capitals and with spaces around it', async () => {
    const db = await withTestDb();
    await insertUser(db, gabriel);

    const response = await post(db, '/api/auth/login', {
      email: '  Gabriel@Example.COM ',
      password: gabriel.password,
    });

    expect(response.status).toBe(200);
  });

  it('refuses a body that names a username, as the client before this phase does', async () => {
    const db = await withTestDb();
    await insertUser(db, gabriel);

    // This is why the branch waits: the sign-in screen in production still
    // sends `username`, and deploying the server alone would lock the owner
    // out of every new device until the screens of plan 3 ship with it.
    // The account's real address goes under the old key, so a login that fell back
    // to `username` would find the account and let it in.
    const response = await post(db, '/api/auth/login', {
      username: gabriel.email,
      password: gabriel.password,
    });

    expect(response.status).toBe(401);
  });

  it(
    'limits attempts per IP across addresses, keeps counting after a success, and tells IPs apart',
    { timeout: 40_000 },
    async () => {
      const db = await withTestDb();
      await insertUser(db, gabriel);

      for (let attempt = 0; attempt < LIMITS.loginIp.max - 1; attempt += 1) {
        const guess = await post(db, '/api/auth/login', {
          email: `guess${attempt}@example.com`,
          password: 'wrong',
        });
        expect(guess.status).toBe(401);
      }
      // The 30th attempt from this IP, and a right one: it gets in, and forgets
      // only the address's own count, never the IP's.
      expect((await post(db, '/api/auth/login', gabriel)).status).toBe(200);

      const oneTooMany = await post(db, '/api/auth/login', {
        email: 'another@example.com',
        password: 'wrong',
      });
      expect(oneTooMany.status).toBe(429);

      // Same server, another address behind the trusted proxy: its own count.
      const elsewhere = await post(
        db,
        '/api/auth/login',
        { email: 'another@example.com', password: 'wrong' },
        { 'x-forwarded-for': '203.0.113.9' },
      );
      expect(elsewhere.status).toBe(401);
    },
  );
});
