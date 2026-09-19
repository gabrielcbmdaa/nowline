import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { collections, connect } from './db.js';
import { identify, issueToken } from './identity.js';
import { insertUser } from './testing/accounts.js';
import { clearTestDb, closeTestDb, withTestDb } from './testing/mongo.js';
import { STALE_AFTER_MS, addressIsTaken, findUserById, releaseStaleHolder } from './users.js';

const email = 'ana@example.com';
const password = 'correct horse battery';
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000);

describe('users', () => {
  beforeEach(async () => {
    const db = await withTestDb();
    await clearTestDb(db);
    await connect(db);
  });
  afterAll(closeTestDb);

  it('releases an unconfirmed account older than a day, which keeps its password, rows and sessions', async () => {
    const db = await withTestDb();
    const { userId } = await insertUser(db, { email, password, createdAt: hoursAgo(25) });
    const token = await issueToken(db, userId);
    await collections(db).plans.insertOne({ userId, id: 'p1' });
    const hashBefore = (await findUserById(db, userId))!.passwordHash;

    expect(await releaseStaleHolder(db, email)).toBe(true);

    const after = await findUserById(db, userId);
    expect(after?.email).toBeNull();
    expect(after?.passwordHash).toBe(hashBefore);
    expect(await identify(db, `Bearer ${token}`)).toBe(userId);
    expect(await collections(db).plans.countDocuments({ userId })).toBe(1);
  });

  it('keeps the address of an unconfirmed account younger than a day', async () => {
    const db = await withTestDb();
    await insertUser(db, { email, password, createdAt: hoursAgo(23) });

    expect(await releaseStaleHolder(db, email)).toBe(false);
    expect(await addressIsTaken(db, email)).toBe(true);
  });

  it('never releases a confirmed account, however old', async () => {
    const db = await withTestDb();
    await insertUser(db, { email, password, createdAt: hoursAgo(24 * 30), verifiedAt: hoursAgo(24 * 29) });

    expect(await releaseStaleHolder(db, email)).toBe(false);
    expect(await addressIsTaken(db, email)).toBe(true);
  });

  it('does not call an address taken when nobody holds it, or when its holder can be released', async () => {
    const db = await withTestDb();
    expect(await addressIsTaken(db, email)).toBe(false);

    await insertUser(db, { email, password, createdAt: hoursAgo(25) });
    expect(await addressIsTaken(db, email)).toBe(false);
  });

  it('measures a day from when the account was created', () => {
    expect(STALE_AFTER_MS).toBe(24 * 3600_000);
  });
});
