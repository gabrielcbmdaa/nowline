import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { collections, connect } from './db.js';
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
});
