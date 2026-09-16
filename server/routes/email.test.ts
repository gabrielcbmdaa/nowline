import type { Db } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connect } from '../db.js';
import { issueToken } from '../identity.js';
import { issueLink } from '../links.js';
import { insertUser } from '../testing/accounts.js';
import { testApp } from '../testing/app.js';
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
});
