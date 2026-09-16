import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../attempts.js';
import { collections, connect } from '../db.js';
import { identify, issueToken } from '../identity.js';
import { insertUser } from '../testing/accounts.js';
import { TEST_PUBLIC_URL, testApp } from '../testing/app.js';
import { call } from '../testing/http.js';
import { recordingMailer } from '../testing/mail.js';
import { clearTestDb, closeTestDb, withTestDb } from '../testing/mongo.js';
import { findUserById } from '../users.js';

type Registered = { token: string; userId: string; confirmationSent: boolean };

const password = 'correct horse battery';
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000);

function setUp(db: Db) {
  const recording = recordingMailer();
  const register = (body: unknown, headers?: Record<string, string>) =>
    call(testApp(db, recording.mailer), '/api/auth/register', { method: 'POST', body, headers });
  return { ...recording, register };
}

describe('register', () => {
  beforeEach(async () => {
    const db = await withTestDb();
    await clearTestDb(db);
    await connect(db);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(closeTestDb);

  it('creates the account and signs it in at once, with a token that names it', async () => {
    const db = await withTestDb();
    const { register } = setUp(db);

    const reply = await register({ email: 'ana@example.com', password });

    expect(reply.status).toBe(201);
    const body = reply.body as Registered;
    expect(await identify(db, `Bearer ${body.token}`)).toBe(body.userId);
    expect(body.confirmationSent).toBe(true);
    const user = await findUserById(db, body.userId);
    expect(user?.verifiedAt).toBeNull();
  });

  it('stores the address normalized', async () => {
    const db = await withTestDb();
    const { register } = setUp(db);

    const reply = await register({ email: '  Ana@Example.COM ', password });

    const user = await findUserById(db, (reply.body as Registered).userId);
    expect(user?.email).toBe('ana@example.com');
  });

  it('links the confirmation to PUBLIC_URL, whatever host the request claims', async () => {
    const db = await withTestDb();
    const { register, sent } = setUp(db);

    // Node's fetch will not send a made-up Host header; behind a trusted proxy
    // this is the one Express reads as the host, so it is the one to forge.
    await register({ email: 'ana@example.com', password }, { 'x-forwarded-host': 'evil.example' });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ana@example.com');
    expect(sent[0].text).toMatch(new RegExp(`${TEST_PUBLIC_URL}/#confirm=[0-9a-f]{64}`));
    expect(sent[0].text).not.toContain('evil.example');
    expect(sent[0].text).not.toContain('127.0.0.1');
  });

  it('answers 409 for the same address in other capitals', async () => {
    const db = await withTestDb();
    const { register } = setUp(db);
    await register({ email: 'ana@example.com', password });

    const again = await register({ email: 'ANA@example.com', password });

    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: 'email taken' });
  });

  it('refuses what is not an account, saying why, with the minimum when too short', async () => {
    const db = await withTestDb();
    const { register, sent } = setUp(db);

    expect((await register({ email: 42, password })).body).toEqual({ error: 'bad request' });
    expect((await register({ email: 'not-an-address', password })).body).toEqual({ error: 'invalid email' });
    expect((await register({ email: 'ana@example.com', password: 'short' })).body).toEqual({
      error: 'password too short',
      minimum: 12,
    });
    expect((await register({ email: 'ana@example.com', password: 'ñ'.repeat(37) })).body).toEqual({
      error: 'password too long',
    });
    expect(await collections(db).users.countDocuments()).toBe(0);
    expect(sent).toEqual([]);
  });

  it('does not count refusals: five 400s, then a valid registration, succeeds', async () => {
    const db = await withTestDb();
    const { register } = setUp(db);

    for (let i = 0; i < LIMITS.register.max; i += 1) {
      expect((await register({ email: `ana${i}@example.com`, password: 'short' })).status).toBe(400);
    }

    expect((await register({ email: 'ana@example.com', password })).status).toBe(201);
  });

  it(
    'refuses a sixth registration from one IP, and lets another IP register',
    { timeout: 30_000 },
    async () => {
      const db = await withTestDb();
      const { register } = setUp(db);

      for (let i = 0; i < LIMITS.register.max; i += 1) {
        expect((await register({ email: `person${i}@example.com`, password })).status).toBe(201);
      }

      expect((await register({ email: 'sixth@example.com', password })).status).toBe(429);
      const elsewhere = await register(
        { email: 'sixth@example.com', password },
        { 'x-forwarded-for': '203.0.113.9' },
      );
      expect(elsewhere.status).toBe(201);
    },
  );

  it('keeps the account when the confirmation cannot be sent, and says so', async () => {
    const db = await withTestDb();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { register, failNext } = setUp(db);
    failNext();

    const reply = await register({ email: 'ana@example.com', password });

    expect(reply.status).toBe(201);
    expect((reply.body as Registered).confirmationSent).toBe(false);
    expect(await collections(db).users.countDocuments({ email: 'ana@example.com' })).toBe(1);
  });

  it('takes the address from an unconfirmed account older than a day, which keeps its rows and session', async () => {
    const db = await withTestDb();
    const { register } = setUp(db);
    const squatter = await insertUser(db, { email: 'ana@example.com', password, createdAt: hoursAgo(25) });
    const squatterToken = await issueToken(db, squatter.userId);
    await collections(db).plans.insertOne({ userId: squatter.userId, id: 'p1' });

    const reply = await register({ email: 'ana@example.com', password });

    expect(reply.status).toBe(201);
    const ana = reply.body as Registered;
    expect(ana.userId).not.toBe(squatter.userId);
    expect((await findUserById(db, squatter.userId))?.email).toBeNull();
    expect(await identify(db, `Bearer ${squatterToken}`)).toBe(squatter.userId);
    // No row ever reaches another person: Ana's account starts empty.
    expect(await collections(db).plans.countDocuments({ userId: squatter.userId })).toBe(1);
    expect(await collections(db).plans.countDocuments({ userId: ana.userId })).toBe(0);
  });

  it('answers 409 while the holder is younger than a day, or confirmed', async () => {
    const db = await withTestDb();
    const { register } = setUp(db);
    await insertUser(db, { email: 'young@example.com', password, createdAt: hoursAgo(23) });
    await insertUser(db, {
      email: 'confirmed@example.com',
      password,
      createdAt: hoursAgo(24 * 30),
      verifiedAt: hoursAgo(24 * 29),
    });

    expect((await register({ email: 'young@example.com', password })).status).toBe(409);
    expect((await register({ email: 'confirmed@example.com', password })).status).toBe(409);
  });
});
