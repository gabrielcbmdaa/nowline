import type { Db } from 'mongodb';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LIMITS } from '../attempts.js';
import { collections, connect } from '../db.js';
import { identify, issueToken } from '../identity.js';
import { issueLink } from '../links.js';
import { insertUser } from '../testing/accounts.js';
import { TEST_PUBLIC_URL, testApp } from '../testing/app.js';
import { call } from '../testing/http.js';
import { recordingMailer } from '../testing/mail.js';
import { clearTestDb, closeTestDb, withTestDb } from '../testing/mongo.js';
import { findUserById } from '../users.js';

const password = 'correct horse battery';
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3600_000);

function setUp(db: Db) {
  const recording = recordingMailer();
  const app = testApp(db, recording.mailer);
  const post = (path: string, body: unknown, token?: string) => call(app, path, { method: 'POST', body, token });
  return { ...recording, app, post };
}

function confirmTokenIn(text: string): string {
  const match = /#confirm=([0-9a-f]{64})/.exec(text);
  if (!match) throw new Error(`no confirmation link in: ${text}`);
  return match[1];
}

async function signedIn(db: Db, seed: { email: string | null; verifiedAt?: Date | null; createdAt?: Date }) {
  const { userId } = await insertUser(db, { password, ...seed });
  return { userId, token: await issueToken(db, userId) };
}

describe('confirm', () => {
  beforeEach(async () => {
    const db = await withTestDb();
    await clearTestDb(db);
    await connect(db);
  });
  afterAll(closeTestDb);

  it('confirms the address a registration emailed, once', async () => {
    const db = await withTestDb();
    const { post, sent } = setUp(db);
    const registered = await post('/api/auth/register', { email: 'ana@example.com', password });
    const { userId } = registered.body as { userId: string };
    const token = confirmTokenIn(sent[0].text);

    const reply = await post('/api/auth/confirm', { token });

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ confirmed: 'email' });
    expect((await findUserById(db, userId))?.verifiedAt).toBeInstanceOf(Date);
    expect((await post('/api/auth/confirm', { token })).status).toBe(410);
  });

  it('answers 410 once the address was released to someone who registered it', async () => {
    const db = await withTestDb();
    const { post } = setUp(db);
    const squatter = await insertUser(db, { email: 'ana@example.com', password, createdAt: hoursAgo(25) });
    const squattersLink = await issueLink(db, { userId: squatter.userId, purpose: 'verify', email: 'ana@example.com' });
    expect((await post('/api/auth/register', { email: 'ana@example.com', password })).status).toBe(201);

    const late = await post('/api/auth/confirm', { token: squattersLink });

    expect(late.status).toBe(410);
    expect((await findUserById(db, squatter.userId))?.verifiedAt).toBeNull();
  });

  it('does not take a reset link for a confirmation', async () => {
    const db = await withTestDb();
    const { post } = setUp(db);
    const { userId } = await insertUser(db, { email: 'ana@example.com', password });
    const token = await issueLink(db, { userId, purpose: 'reset', email: 'ana@example.com' });

    expect((await post('/api/auth/confirm', { token })).status).toBe(410);
    expect((await findUserById(db, userId))?.verifiedAt).toBeNull();
  });
});

describe('change-email', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    const db = await withTestDb();
    await clearTestDb(db);
    await connect(db);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(closeTestDb);

  it('answers 403 to a wrong current password, sends nothing, and leaves the device signed in', async () => {
    const db = await withTestDb();
    const { post, sent } = setUp(db);
    const ana = await signedIn(db, { email: 'old@example.com', verifiedAt: new Date() });

    const reply = await post('/api/auth/change-email', { email: 'new@example.com', password: 'not my password' }, ana.token);

    // Never 401: the client signs a device out on any 401.
    expect(reply.status).toBe(403);
    expect(reply.body).toEqual({ error: 'wrong password' });
    expect(sent).toEqual([]);
    expect(await identify(db, `Bearer ${ana.token}`)).toBe(ana.userId);
  });

  it('refuses without a session, an invalid address and the address it already has', async () => {
    const db = await withTestDb();
    const { post } = setUp(db);
    const ana = await signedIn(db, { email: 'old@example.com' });

    expect((await post('/api/auth/change-email', { email: 'new@example.com', password })).status).toBe(401);
    expect((await post('/api/auth/change-email', { email: 'nope', password }, ana.token)).body).toEqual({
      error: 'invalid email',
    });
    expect((await post('/api/auth/change-email', { email: ' OLD@example.com', password }, ana.token)).body).toEqual({
      error: 'same email',
    });
  });

  it('sends the link to the new address only, and changes nothing until it is opened', async () => {
    const db = await withTestDb();
    const { post, sent } = setUp(db);
    const ana = await signedIn(db, { email: 'old@example.com', verifiedAt: new Date() });

    const reply = await post('/api/auth/change-email', { email: 'New@Example.com', password }, ana.token);

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ sent: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('new@example.com');
    expect(sent[0].text).toMatch(new RegExp(`${TEST_PUBLIC_URL}/#confirm=[0-9a-f]{64}`));
    expect((await findUserById(db, ana.userId))?.email).toBe('old@example.com');
  });

  it(
    'on opening the link, sets the address and confirms it, drops the other links and tells the confirmed old address',
    { timeout: 20_000 },
    async () => {
      const db = await withTestDb();
      const { post, sent } = setUp(db);
      const ana = await signedIn(db, { email: 'old@example.com', verifiedAt: hoursAgo(48) });
      await issueLink(db, { userId: ana.userId, purpose: 'reset', email: 'old@example.com' });
      await post('/api/auth/change-email', { email: 'new@example.com', password }, ana.token);

      const reply = await post('/api/auth/confirm', { token: confirmTokenIn(sent[0].text) });

      expect(reply.status).toBe(200);
      expect(reply.body).toEqual({ confirmed: 'new-email' });
      const user = await findUserById(db, ana.userId);
      expect(user?.email).toBe('new@example.com');
      expect(user!.verifiedAt!.getTime()).toBeGreaterThan(hoursAgo(1).getTime());
      expect(await collections(db).emailLinks.countDocuments({ userId: ana.userId })).toBe(0);
      await vi.waitFor(() => expect(sent).toHaveLength(2));
      expect(sent[1].to).toBe('old@example.com');
      expect(sent[1].text).toContain('n…@example.com');
    },
  );

  it('does not tell an old address that was never confirmed', async () => {
    const db = await withTestDb();
    const { post, sent, app } = setUp(db);
    const ana = await signedIn(db, { email: 'typo@gmial.com' });
    await post('/api/auth/change-email', { email: 'ana@gmail.com', password }, ana.token);

    expect((await post('/api/auth/confirm', { token: confirmTokenIn(sent[0].text) })).status).toBe(200);

    await call(app, '/api/health');
    expect(sent).toHaveLength(1);
  });

  it('works for an account whose address was released, which is how it gets one back', async () => {
    const db = await withTestDb();
    const { post, sent } = setUp(db);
    const ana = await signedIn(db, { email: null });

    expect((await post('/api/auth/change-email', { email: 'ana@example.com', password }, ana.token)).status).toBe(200);
    expect((await post('/api/auth/confirm', { token: confirmTokenIn(sent[0].text) })).status).toBe(200);
    expect((await findUserById(db, ana.userId))?.email).toBe('ana@example.com');
  });

  it('answers 409 early when a confirmed or recent account holds the address', async () => {
    const db = await withTestDb();
    const { post, sent } = setUp(db);
    await insertUser(db, { email: 'held@example.com', password, verifiedAt: new Date() });
    const ana = await signedIn(db, { email: 'ana@example.com' });

    const reply = await post('/api/auth/change-email', { email: 'held@example.com', password }, ana.token);

    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({ error: 'email taken' });
    expect(sent).toEqual([]);
  });

  it('answers 409 at consumption when someone registered the address in between', async () => {
    const db = await withTestDb();
    const { post, sent } = setUp(db);
    const ana = await signedIn(db, { email: 'ana@example.com', verifiedAt: new Date() });
    await post('/api/auth/change-email', { email: 'wanted@example.com', password }, ana.token);
    const link = confirmTokenIn(sent[0].text);
    expect((await post('/api/auth/register', { email: 'wanted@example.com', password })).status).toBe(201);

    const reply = await post('/api/auth/confirm', { token: link });

    expect(reply.status).toBe(409);
    expect(reply.body).toEqual({ error: 'email taken' });
    expect((await findUserById(db, ana.userId))?.email).toBe('ana@example.com');
  });

  it('releases a holder older than a day at consumption, and takes the address', async () => {
    const db = await withTestDb();
    const { post, sent } = setUp(db);
    const squatter = await insertUser(db, { email: 'wanted@example.com', password, createdAt: hoursAgo(25) });
    const ana = await signedIn(db, { email: 'ana@example.com', verifiedAt: new Date() });

    expect((await post('/api/auth/change-email', { email: 'wanted@example.com', password }, ana.token)).status).toBe(200);
    expect((await post('/api/auth/confirm', { token: confirmTokenIn(sent[0].text) })).status).toBe(200);

    expect((await findUserById(db, ana.userId))?.email).toBe('wanted@example.com');
    expect((await findUserById(db, squatter.userId))?.email).toBeNull();
  });

  it('counts wrong passwords: the fourth attempt in an hour answers 429', { timeout: 20_000 }, async () => {
    const db = await withTestDb();
    const { post } = setUp(db);
    const ana = await signedIn(db, { email: 'ana@example.com' });

    for (let i = 0; i < LIMITS.changeEmail.max; i += 1) {
      const guess = await post('/api/auth/change-email', { email: 'new@example.com', password: `guess ${i} guess` }, ana.token);
      expect(guess.status).toBe(403);
    }

    const fourth = await post('/api/auth/change-email', { email: 'new@example.com', password }, ana.token);
    expect(fourth.status).toBe(429);
  });
});

describe('send-confirmation', () => {
  beforeEach(async () => {
    const db = await withTestDb();
    await clearTestDb(db);
    await connect(db);
  });
  afterAll(closeTestDb);

  it('sends a new confirmation link to the address on the account', async () => {
    const db = await withTestDb();
    const { post, sent } = setUp(db);
    const ana = await signedIn(db, { email: 'ana@example.com' });

    const reply = await post('/api/auth/send-confirmation', {}, ana.token);

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ sent: true });
    expect(sent[0].to).toBe('ana@example.com');
    expect((await post('/api/auth/confirm', { token: confirmTokenIn(sent[0].text) })).body).toEqual({ confirmed: 'email' });
  });

  it('answers 409 when the account is already confirmed, and when it has no address', async () => {
    const db = await withTestDb();
    const { post, sent } = setUp(db);
    const confirmed = await signedIn(db, { email: 'ana@example.com', verifiedAt: new Date() });
    const released = await signedIn(db, { email: null });

    expect((await post('/api/auth/send-confirmation', {}, confirmed.token)).body).toEqual({ error: 'already confirmed' });
    expect((await post('/api/auth/send-confirmation', {}, released.token)).body).toEqual({ error: 'no email' });
    expect(sent).toEqual([]);
  });

  it('answers 401 without a session', async () => {
    const db = await withTestDb();
    const { post } = setUp(db);

    expect((await post('/api/auth/send-confirmation', {})).status).toBe(401);
  });

  it('refuses a fourth resend within the hour: the limit that keeps a squatter out of an inbox', async () => {
    const db = await withTestDb();
    const { post, sent } = setUp(db);
    const ana = await signedIn(db, { email: 'ana@example.com' });

    for (let i = 0; i < LIMITS.sendConfirmation.max; i += 1) {
      expect((await post('/api/auth/send-confirmation', {}, ana.token)).status).toBe(200);
    }

    const fourth = await post('/api/auth/send-confirmation', {}, ana.token);
    expect(fourth.status).toBe(429);
    expect(sent).toHaveLength(LIMITS.sendConfirmation.max);
  });
});
