import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { collections } from './db.js';
import { identify, issueToken, revokeToken } from './identity.js';
import { clearTestDb, closeTestDb, withTestDb } from './testing/mongo.js';

describe('identity', () => {
  beforeEach(async () => clearTestDb(await withTestDb()));
  afterAll(closeTestDb);

  it('recognises the token it just issued', async () => {
    const db = await withTestDb();
    const token = await issueToken(db, 'u1');

    expect(await identify(db, `Bearer ${token}`)).toBe('u1');
  });

  it('never stores the token itself, only a fingerprint of it', async () => {
    const db = await withTestDb();
    const token = await issueToken(db, 'u1');

    const stored = await collections(db).sessions.find({}).toArray();
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('does not recognise a token that was revoked', async () => {
    const db = await withTestDb();
    const token = await issueToken(db, 'u1');

    await revokeToken(db, token);

    expect(await identify(db, `Bearer ${token}`)).toBeNull();
  });

  it('refuses a missing, malformed or unknown header', async () => {
    const db = await withTestDb();

    expect(await identify(db, undefined)).toBeNull();
    expect(await identify(db, 'Bearer')).toBeNull();
    expect(await identify(db, 'Basic abc')).toBeNull();
    expect(await identify(db, 'Bearer not-a-real-token')).toBeNull();
  });
});
