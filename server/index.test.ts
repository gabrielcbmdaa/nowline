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
});
