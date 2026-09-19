import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LIMITS } from './attempts.js';
import { collections, connect, isDuplicateKeyOn } from './db.js';
import { assertSafeTestTarget, clearTestDb, closeTestDb, withTestDb } from './testing/mongo.js';

describe('the test database guard', () => {
  it('refuses a database that is not the test one', () => {
    expect(() => assertSafeTestTarget('mongodb://127.0.0.1:27017', 'nowline_dev')).toThrow();
    expect(() => assertSafeTestTarget('mongodb://127.0.0.1:27017', 'nowline')).toThrow();
  });

  it('refuses a suffix with characters outside [a-z0-9_]', () => {
    expect(() =>
      assertSafeTestTarget('mongodb://127.0.0.1:27017', 'nowline_test_evil.path'),
    ).toThrow();
    expect(() =>
      assertSafeTestTarget('mongodb://127.0.0.1:27017', 'nowline_test_evil-example'),
    ).toThrow();
  });

  it('refuses a host that is not this machine', () => {
    expect(() => assertSafeTestTarget('mongodb://127.0.0.1:27018', 'nowline_test')).toThrow();
    expect(() => assertSafeTestTarget('mongodb://example.com:27017', 'nowline_test')).toThrow();
  });

  it('refuses hosts that merely begin with the allowed prefix', () => {
    expect(() =>
      assertSafeTestTarget('mongodb://127.0.0.1:27017@evil.example:27017', 'nowline_test'),
    ).toThrow();
    expect(() => assertSafeTestTarget('mongodb://127.0.0.1:27017.evil.example', 'nowline_test')).toThrow();
    expect(() => assertSafeTestTarget('mongodb://127.0.0.1:270170', 'nowline_test')).toThrow();
  });

  it('allows the test database on this machine', () => {
    expect(() => assertSafeTestTarget('mongodb://127.0.0.1:27017', 'nowline_test')).not.toThrow();
    expect(() =>
      assertSafeTestTarget('mongodb://127.0.0.1:27017', 'nowline_test_a1b2c3d4'),
    ).not.toThrow();
  });
});

describe('the database', () => {
  beforeEach(async () => {
    await clearTestDb(await withTestDb());
  });
  afterAll(closeTestDb);

  it('indexes each collection by owner and by when the server stamped it', async () => {
    const db = await withTestDb();
    await connect(db);

    for (const name of ['projects', 'plans', 'overrides']) {
      const indexes = await db.collection(name).indexes();
      const found = indexes.some(
        (index) => index.key.userId === 1 && index.key.serverUpdatedAt === 1,
      );
      expect(found, `${name} has no { userId, serverUpdatedAt } index`).toBe(true);
    }
  });

  it('refuses two sessions with the same token hash', async () => {
    const db = await withTestDb();
    await connect(db);
    const { sessions } = collections(db);

    await sessions.insertOne({ tokenHash: 'same', userId: 'u1', createdAt: new Date() });

    await expect(
      sessions.insertOne({ tokenHash: 'same', userId: 'u2', createdAt: new Date() }),
    ).rejects.toThrow();
  });

  it('refuses a second row with the same id for the same owner', async () => {
    const db = await withTestDb();
    await connect(db);

    await collections(db).plans.insertOne({ userId: 'me', id: 'p1' });

    await expect(collections(db).plans.insertOne({ userId: 'me', id: 'p1' })).rejects.toThrow(
      /duplicate key/i,
    );
  });

  it('lets two owners each have a row with the same id', async () => {
    const db = await withTestDb();
    await connect(db);

    await collections(db).plans.insertOne({ userId: 'me', id: 'p1' });
    await collections(db).plans.insertOne({ userId: 'them', id: 'p1' });

    expect(await collections(db).plans.countDocuments({ id: 'p1' })).toBe(2);
  });

  it('lets attempts rows expire on their own once the longest window has passed', async () => {
    const db = await withTestDb();
    await connect(db);

    const indexes = await db.collection('attempts').indexes();
    const ttl = indexes.find((index) => index.key.windowStartedAt === 1);
    const longestWindowMinutes = Math.max(...Object.values(LIMITS).map((entry) => entry.windowMinutes));
    expect(ttl?.expireAfterSeconds).toBe(longestWindowMinutes * 60);
    expect(indexes.some((index) => index.key.key === 1 && index.unique === true)).toBe(true);
  });

  it('drops a leftover username_1, so a second account without a username can exist', async () => {
    const db = await withTestDb();
    await db.collection('users').createIndex({ username: 1 }, { unique: true });

    await connect(db);

    const names = (await collections(db).users.indexes()).map((index) => index.name);
    expect(names).not.toContain('username_1');
    // A unique index treats a missing field as null: with username_1 still
    // there, the second insert would collide with the first.
    const row = { passwordHash: 'not-a-hash', verifiedAt: null, createdAt: new Date() };
    await collections(db).users.insertOne({ email: 'first@example.com', ...row });
    await collections(db).users.insertOne({ email: 'second@example.com', ...row });
    expect(await collections(db).users.countDocuments()).toBe(2);
  });

  it('allows two released accounts and refuses two equal emails', async () => {
    const db = await withTestDb();
    await connect(db);
    const row = { passwordHash: 'not-a-hash', verifiedAt: null, createdAt: new Date() };

    // Released accounts hold email: null, and a plain unique index would allow one.
    await collections(db).users.insertOne({ email: null, ...row });
    await collections(db).users.insertOne({ email: null, ...row });
    await collections(db).users.insertOne({ email: 'ana@example.com', ...row });

    await expect(
      collections(db).users.insertOne({ email: 'ana@example.com', ...row }),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('tells which index a duplicate key hit', async () => {
    const db = await withTestDb();
    await connect(db);
    const row = { passwordHash: 'not-a-hash', verifiedAt: null, createdAt: new Date() };
    await collections(db).users.insertOne({ email: 'ana@example.com', ...row });

    const error: unknown = await collections(db)
      .users.insertOne({ email: 'ana@example.com', ...row })
      .catch((caught: unknown) => caught);

    expect(isDuplicateKeyOn(error, 'email')).toBe(true);
    expect(isDuplicateKeyOn(error, 'tokenHash')).toBe(false);
    expect(isDuplicateKeyOn(new Error('duplicate key'), 'email')).toBe(false);
  });

  it('indexes email links by hash, by expiry with a TTL, and by owner and purpose', async () => {
    const db = await withTestDb();
    await connect(db);

    const indexes = await db.collection('emailLinks').indexes();
    expect(indexes.some((index) => index.key.tokenHash === 1 && index.unique === true)).toBe(true);
    const ttl = indexes.find((index) => index.key.expiresAt === 1);
    expect(ttl?.expireAfterSeconds).toBe(0);
    expect(indexes.some((index) => index.key.userId === 1 && index.key.purpose === 1)).toBe(true);
  });
});
