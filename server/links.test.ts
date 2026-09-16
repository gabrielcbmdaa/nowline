import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collections, connect } from './db.js';
import { fingerprint } from './identity.js';
import { consumeLink, issueLink } from './links.js';
import { clearTestDb, closeTestDb, withTestDb } from './testing/mongo.js';

const ana = { userId: 'u1', email: 'ana@example.com' };

describe('links', () => {
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

  it('hands out a token it never stores, and consumes it exactly once', async () => {
    const db = await withTestDb();
    const token = await issueLink(db, { ...ana, purpose: 'verify' });

    const stored = await collections(db).emailLinks.find({}).toArray();
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(token);

    const first = await consumeLink(db, token, ['verify']);
    expect(first?.email).toBe(ana.email);
    expect(first?.userId).toBe(ana.userId);
    expect(await consumeLink(db, token, ['verify'])).toBeNull();
  });

  it('lets exactly one of two concurrent consumptions through', async () => {
    const db = await withTestDb();
    // Two reads in flight at once make the driver open a second connection.
    // On one connection two operations run one after the other, and a read
    // followed by a delete would look atomic here without ever being so.
    await Promise.all([
      collections(db).emailLinks.countDocuments(),
      collections(db).emailLinks.countDocuments(),
    ]);

    // Five rounds: with two connections a read-then-delete lets both callers
    // through almost every time, and five rounds turn "almost" into "every run".
    for (let round = 0; round < 5; round += 1) {
      const token = await issueLink(db, { ...ana, purpose: 'reset' });
      const results = await Promise.all([
        consumeLink(db, token, ['reset']),
        consumeLink(db, token, ['reset']),
      ]);
      expect(results.filter((row) => row !== null), `round ${round}`).toHaveLength(1);
    }
  });

  it('does not consume a row that expired but is still stored', async () => {
    // In the future on purpose: mongod's TTL monitor runs on its own clock and would
    // delete a row expired in real time, and then this test would prove nothing.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2099, 8, 15, 10, 0, 0));
    const db = await withTestDb();
    const token = 'a'.repeat(64);
    // Expired a second ago by the clock consumeLink reads, and still stored.
    await collections(db).emailLinks.insertOne({
      tokenHash: fingerprint(token),
      userId: ana.userId,
      purpose: 'reset',
      email: ana.email,
      expiresAt: new Date(Date.now() - 1000),
    });

    expect(await consumeLink(db, token, ['reset'])).toBeNull();
  });

  it('invalidates the earlier link of the same purpose when issuing again, and no other', async () => {
    const db = await withTestDb();
    const verify = await issueLink(db, { ...ana, purpose: 'verify' });
    const earlier = await issueLink(db, { ...ana, purpose: 'reset' });
    const someoneElses = await issueLink(db, { userId: 'u2', email: 'bo@example.com', purpose: 'reset' });
    const later = await issueLink(db, { ...ana, purpose: 'reset' });

    expect(await consumeLink(db, earlier, ['reset'])).toBeNull();
    expect(await consumeLink(db, later, ['reset'])).not.toBeNull();
    expect(await consumeLink(db, verify, ['verify'])).not.toBeNull();
    // Another account's link of the same purpose is not this account's to invalidate.
    expect(await consumeLink(db, someoneElses, ['reset'])).not.toBeNull();
  });

  it('does not consume a link for another purpose', async () => {
    const db = await withTestDb();
    const verify = await issueLink(db, { ...ana, purpose: 'verify' });
    const change = await issueLink(db, { ...ana, purpose: 'change-email' });

    expect(await consumeLink(db, verify, ['reset'])).toBeNull();
    // The accepted set is the whole list, not its first element.
    expect(await consumeLink(db, change, ['verify', 'change-email'])).not.toBeNull();
    expect(await consumeLink(db, verify, ['verify', 'change-email'])).not.toBeNull();
  });

  it('gives a reset an hour and a confirmation a day', async () => {
    vi.useFakeTimers();
    // In the future on purpose: mongod's TTL monitor runs on its own clock.
    vi.setSystemTime(new Date(2099, 8, 15, 10, 0, 0));
    const db = await withTestDb();
    await issueLink(db, { ...ana, purpose: 'reset' });
    await issueLink(db, { ...ana, purpose: 'verify' });
    await issueLink(db, { ...ana, purpose: 'change-email' });

    const rows = await collections(db).emailLinks.find({}).toArray();
    const lifetime = (purpose: string) =>
      rows.find((row) => row.purpose === purpose)!.expiresAt.getTime() - Date.now();

    expect(lifetime('reset')).toBe(3600_000);
    expect(lifetime('verify')).toBe(24 * 3600_000);
    expect(lifetime('change-email')).toBe(24 * 3600_000);
  });
});
