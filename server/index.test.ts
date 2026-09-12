import { afterEach, describe, expect, it } from 'vitest';
import { createApp, readConfig } from './index.js';
import { call } from './testing/http.js';
import { withTestDb } from './testing/mongo.js';

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

describe('readConfig', () => {
  it('throws when MONGO_DB is missing', () => {
    process.env.MONGO_URL = 'mongodb://127.0.0.1:27017';
    delete process.env.MONGO_DB;

    expect(() => readConfig()).toThrow('Set MONGO_URL and MONGO_DB before starting the server');
  });

  it('throws when MONGO_URL is missing', () => {
    process.env.MONGO_DB = 'nowline_test';
    delete process.env.MONGO_URL;

    expect(() => readConfig()).toThrow('Set MONGO_URL and MONGO_DB before starting the server');
  });

  it('returns url, dbName, and port 3001 when PORT is unset', () => {
    process.env.MONGO_URL = 'mongodb://127.0.0.1:27017';
    process.env.MONGO_DB = 'nowline_test';
    delete process.env.PORT;

    expect(readConfig()).toEqual({
      url: 'mongodb://127.0.0.1:27017',
      dbName: 'nowline_test',
      port: 3001,
    });
  });
});

describe('the server', () => {
  it('answers that it is alive', async () => {
    const db = await withTestDb();
    const reply = await call(createApp(db), '/api/health');

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true });
  });

  it('answers 404 in JSON, not in HTML', async () => {
    const db = await withTestDb();
    const reply = await call(createApp(db), '/api/nothing-here');

    expect(reply.status).toBe(404);
    expect(reply.contentType).toContain('application/json');
  });

  it('answers a broken body in JSON, without saying what it is made of', async () => {
    const db = await withTestDb();
    const reply = await call(createApp(db), '/api/auth/login', {
      method: 'POST',
      rawBody: '{"username": "gabriel" "password": "whatever"}',
    });

    // Express's own handler answers HTML with the whole stack: absolute paths,
    // the system user's name, and the exact version of every dependency the
    // error passed through. Behind nginx that is a list of which known
    // vulnerabilities to try, handed to anyone who sends rubbish to the door.
    expect(reply.status).toBe(400);
    expect(reply.contentType).toContain('application/json');
    expect(reply.text).not.toMatch(/node_modules/);
    expect(reply.text).not.toMatch(/at .*\(/);
    expect(reply.body).toEqual({ error: 'bad request' });
  });
});
