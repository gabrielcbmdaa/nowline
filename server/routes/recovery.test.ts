import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../attempts.js';
import { connect } from '../db.js';
import { identify, issueToken } from '../identity.js';
import { issueLink } from '../links.js';
import { insertUser } from '../testing/accounts.js';
import { TEST_PUBLIC_URL, testApp } from '../testing/app.js';
import { call } from '../testing/http.js';
import { recordingMailer } from '../testing/mail.js';
import { clearTestDb, closeTestDb, withTestDb } from '../testing/mongo.js';

const oldPassword = 'correct horse battery';
const newPassword = 'a brand new passphrase';

function setUp(db: Db) {
  const recording = recordingMailer();
  const app = testApp(db, recording.mailer);
  const post = (path: string, body: unknown) => call(app, path, { method: 'POST', body });
  return { ...recording, app, post };
}

async function confirmedAccount(db: Db, email = 'ana@example.com') {
  const { userId } = await insertUser(db, { email, password: oldPassword, verifiedAt: new Date() });
  return { userId, email };
}

describe('request-reset', () => {
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

  it('answers the same for an unknown, an unconfirmed and a confirmed address, and emails only the confirmed one', async () => {
    const db = await withTestDb();
    const { post, sent, app } = setUp(db);
    await insertUser(db, { email: 'unconfirmed@example.com', password: oldPassword });
    await confirmedAccount(db, 'confirmed@example.com');

    const unknown = await post('/api/auth/request-reset', { email: 'nobody@example.com' });
    const unconfirmed = await post('/api/auth/request-reset', { email: 'unconfirmed@example.com' });
    const confirmed = await post('/api/auth/request-reset', { email: 'Confirmed@Example.com' });

    for (const reply of [unknown, unconfirmed, confirmed]) {
      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({});
    }
    // The email goes after the reply, so it is waited for. The confirmed request
    // was the last one sent, so an email for either earlier one would arrive first.
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    await call(app, '/api/health');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('confirmed@example.com');
    expect(sent[0].text).toMatch(new RegExp(`${TEST_PUBLIC_URL}/#reset=[0-9a-f]{64}`));
  });

  it('refuses a fourth request for one address within the hour', async () => {
    const db = await withTestDb();
    const { post } = setUp(db);

    for (let i = 0; i < LIMITS.reset.max; i += 1) {
      expect((await post('/api/auth/request-reset', { email: 'nobody@example.com' })).status).toBe(200);
    }

    expect((await post('/api/auth/request-reset', { email: 'nobody@example.com' })).status).toBe(429);
  });

  it('answers 400 when the address is not a string', async () => {
    const db = await withTestDb();
    const { post } = setUp(db);

    expect((await post('/api/auth/request-reset', { email: ['a@b'] })).body).toEqual({ error: 'bad request' });
  });
});

describe('reset', () => {
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

  it('leaves the link usable when the new password is too short', async () => {
    const db = await withTestDb();
    const { post } = setUp(db);
    const ana = await confirmedAccount(db);
    const token = await issueLink(db, { ...ana, purpose: 'reset' });

    const tooShort = await post('/api/auth/reset', { token, password: 'short' });
    expect(tooShort.status).toBe(400);
    expect(tooShort.body).toEqual({ error: 'password too short', minimum: 12 });

    expect((await post('/api/auth/reset', { token, password: newPassword })).status).toBe(200);
  });

  it(
    'ends every earlier session, hands this device one that works, and lifts the login lock',
    { timeout: 20_000 },
    async () => {
      const db = await withTestDb();
      const { post } = setUp(db);
      const ana = await confirmedAccount(db);
      const phone = await issueToken(db, ana.userId);
      const laptop = await issueToken(db, ana.userId);
      for (let i = 0; i < LIMITS.login.max; i += 1) {
        await post('/api/auth/login', { email: ana.email, password: 'wrong guess' });
      }
      expect((await post('/api/auth/login', { email: ana.email, password: oldPassword })).status).toBe(429);
      const token = await issueLink(db, { ...ana, purpose: 'reset' });

      const reply = await post('/api/auth/reset', { token, password: newPassword });

      expect(reply.status).toBe(200);
      const body = reply.body as { token: string; userId: string };
      expect(body.userId).toBe(ana.userId);
      expect(await identify(db, `Bearer ${body.token}`)).toBe(ana.userId);
      expect(await identify(db, `Bearer ${phone}`)).toBeNull();
      expect(await identify(db, `Bearer ${laptop}`)).toBeNull();
      expect((await post('/api/auth/login', { email: ana.email, password: oldPassword })).status).toBe(401);
      expect((await post('/api/auth/login', { email: ana.email, password: newPassword })).status).toBe(200);
    },
  );

  it('answers 410 to a link used twice', async () => {
    const db = await withTestDb();
    const { post } = setUp(db);
    const ana = await confirmedAccount(db);
    const token = await issueLink(db, { ...ana, purpose: 'reset' });

    await post('/api/auth/reset', { token, password: newPassword });
    const again = await post('/api/auth/reset', { token, password: 'yet another passphrase' });

    expect(again.status).toBe(410);
    expect(again.body).toEqual({ error: 'link expired or used' });
  });

  it('answers 410 to a link older than an hour', async () => {
    vi.useFakeTimers();
    // In the future on purpose: mongod's TTL monitor runs on its own clock, and only a
    // row it has not deleted shows that consumeLink's own expiresAt check refuses it.
    const issuedAt = new Date(2099, 8, 15, 10, 0, 0);
    vi.setSystemTime(issuedAt);
    const db = await withTestDb();
    const { post } = setUp(db);
    const ana = await confirmedAccount(db);
    const token = await issueLink(db, { ...ana, purpose: 'reset' });

    vi.setSystemTime(new Date(issuedAt.getTime() + 61 * 60_000));

    expect((await post('/api/auth/reset', { token, password: newPassword })).status).toBe(410);
  });

  it('does not take a confirmation link for a reset', async () => {
    const db = await withTestDb();
    const { post } = setUp(db);
    const ana = await confirmedAccount(db);
    const token = await issueLink(db, { ...ana, purpose: 'verify' });

    expect((await post('/api/auth/reset', { token, password: newPassword })).status).toBe(410);
  });
});
