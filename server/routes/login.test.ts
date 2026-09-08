import type { Db } from 'mongodb';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { collections } from '../db.js';
import { createApp } from '../index.js';
import { identify } from '../identity.js';
import { hashPassword } from '../passwords.js';
import { call } from '../testing/http.js';
import { clearTestDb, closeTestDb, withTestDb } from '../testing/mongo.js';

const post = (db: Db, path: string, body: unknown, token?: string) =>
  call(createApp(db), path, { method: 'POST', body, token });

describe('login', () => {
  beforeEach(async () => clearTestDb(await withTestDb()));
  afterAll(closeTestDb);

  it('hands back a token that then identifies the user', async () => {
    const db = await withTestDb();
    await collections(db).users.insertOne({
      username: 'gabriel',
      passwordHash: await hashPassword('correct horse'),
    });

    const response = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'correct horse',
    });

    expect(response.status).toBe(200);
    const { token } = response.body as { token: string };
    expect(await identify(db, `Bearer ${token}`)).not.toBeNull();
  });

  it('answers the same way to a wrong password and to a user that does not exist', async () => {
    const db = await withTestDb();
    await collections(db).users.insertOne({
      username: 'gabriel',
      passwordHash: await hashPassword('correct horse'),
    });

    const wrongPassword = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'wrong',
    });
    const noSuchUser = await post(db, '/api/auth/login', {
      username: 'nobody',
      password: 'wrong',
    });

    expect(wrongPassword.status).toBe(401);
    expect(noSuchUser.status).toBe(401);
    expect(wrongPassword.body).toEqual(noSuchUser.body);
  });

  it('never sends the hash back', async () => {
    const db = await withTestDb();
    const passwordHash = await hashPassword('correct horse');
    await collections(db).users.insertOne({ username: 'gabriel', passwordHash });

    const response = await post(db, '/api/auth/login', {
      username: 'gabriel',
      password: 'correct horse',
    });

    expect(JSON.stringify(response.body)).not.toContain(passwordHash);
  });
});
