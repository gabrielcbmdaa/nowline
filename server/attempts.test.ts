import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS, countAttempt, forgetAttempts } from './attempts.js';
import { connect } from './db.js';
import { clearTestDb, closeTestDb, withTestDb } from './testing/mongo.js';

// Small numbers so the tests say what they mean; the real table is LIMITS.
const limit = { max: 3, windowMinutes: 15 };

describe('countAttempt', () => {
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

  it('is under the limit for max attempts and over it from the next one', async () => {
    const db = await withTestDb();

    const answers: boolean[] = [];
    for (let i = 0; i < limit.max + 1; i += 1) answers.push(await countAttempt(db, 'k', limit));

    expect(answers).toEqual([false, false, false, true]);
  });

  it('keeps every key on its own', async () => {
    const db = await withTestDb();
    for (let i = 0; i < limit.max; i += 1) await countAttempt(db, 'a', limit);

    expect(await countAttempt(db, 'b', limit)).toBe(false);
  });

  it('starts again after forgetAttempts', async () => {
    const db = await withTestDb();
    for (let i = 0; i < limit.max; i += 1) await countAttempt(db, 'k', limit);

    await forgetAttempts(db, 'k');

    expect(await countAttempt(db, 'k', limit)).toBe(false);
  });

  it('reopens once the window has passed, and not a minute before', async () => {
    vi.useFakeTimers();
    // In the future on purpose: mongod applies the TTL index against its own clock,
    // and a window stamped in the past can vanish mid-test and reopen the door.
    const startedAt = new Date(2099, 8, 15, 10, 0, 0);
    vi.setSystemTime(startedAt);
    const db = await withTestDb();
    for (let i = 0; i < limit.max + 1; i += 1) await countAttempt(db, 'k', limit);

    vi.setSystemTime(new Date(startedAt.getTime() + (limit.windowMinutes - 1) * 60_000));
    expect(await countAttempt(db, 'k', limit)).toBe(true);

    vi.setSystemTime(new Date(startedAt.getTime() + (limit.windowMinutes + 1) * 60_000));
    expect(await countAttempt(db, 'k', limit)).toBe(false);
  });

  it('counts attempts fired together, not only one after another', async () => {
    const db = await withTestDb();

    const answers = await Promise.all(
      Array.from({ length: limit.max + 7 }, () => countAttempt(db, 'k', limit)),
    );

    // Every attempt past the limit has to be refused, however they were fired —
    // and refused on purpose: an upsert racing the unique index throws a
    // duplicate-key error, which Promise.all would surface as a rejection here.
    expect(answers.filter(Boolean).length).toBeGreaterThanOrEqual(7);
  });

  it('has no window longer than the hour the attempts TTL keeps rows for', () => {
    const longest = Math.max(...Object.values(LIMITS).map((entry) => entry.windowMinutes));
    expect(longest).toBe(60);
  });
});
