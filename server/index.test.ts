import { afterEach, describe, expect, it } from 'vitest';
import { readConfig } from './index.js';
import { testApp } from './testing/app.js';
import { call } from './testing/http.js';
import { withTestDb } from './testing/mongo.js';

const savedEnv = { ...process.env };

afterEach(() => {
  process.env = { ...savedEnv };
});

const complete = {
  MONGO_URL: 'mongodb://127.0.0.1:27017',
  MONGO_DB: 'nowline_test',
  PUBLIC_URL: 'https://nowline.test',
  MAIL_TRANSPORT: 'zavu',
  MAIL_API_KEY: 'k',
  MAIL_SENDER: 's',
};

/** Every variable set, then the given ones changed — `undefined` removes one. */
function withEnv(overrides: Record<string, string | undefined>): void {
  const merged: Record<string, string | undefined> = { ...savedEnv, ...complete, ...overrides };
  process.env = Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

describe('readConfig', () => {
  it('throws when MONGO_DB is missing', () => {
    withEnv({ MONGO_DB: undefined });

    expect(() => readConfig()).toThrow('Set MONGO_URL and MONGO_DB before starting the server');
  });

  it('throws when MONGO_URL is missing', () => {
    withEnv({ MONGO_URL: undefined });

    expect(() => readConfig()).toThrow('Set MONGO_URL and MONGO_DB before starting the server');
  });

  it('names each variable it cannot start without', () => {
    withEnv({ PUBLIC_URL: undefined });
    expect(() => readConfig()).toThrow('Set PUBLIC_URL before starting the server');

    withEnv({ MAIL_TRANSPORT: undefined });
    expect(() => readConfig()).toThrow('Set MAIL_TRANSPORT before starting the server');

    withEnv({ MAIL_API_KEY: undefined });
    expect(() => readConfig()).toThrow('Set MAIL_API_KEY before starting the server');

    withEnv({ MAIL_SENDER: undefined });
    expect(() => readConfig()).toThrow('Set MAIL_SENDER before starting the server');
  });

  it('refuses a transport it does not know, rather than guessing', () => {
    withEnv({ MAIL_TRANSPORT: 'smtp' });

    expect(() => readConfig()).toThrow('MAIL_TRANSPORT must be "zavu" or "console"');
  });

  it('needs no key for the console transport', () => {
    withEnv({ MAIL_TRANSPORT: 'console', MAIL_API_KEY: undefined, MAIL_SENDER: undefined });

    expect(readConfig().mail).toEqual({ transport: 'console' });
  });

  it('returns everything, with port 3001 when PORT is unset and no slash after the origin', () => {
    withEnv({ PORT: undefined, PUBLIC_URL: 'https://nowline.test/' });

    expect(readConfig()).toEqual({
      url: 'mongodb://127.0.0.1:27017',
      dbName: 'nowline_test',
      port: 3001,
      publicUrl: 'https://nowline.test',
      mail: { transport: 'zavu', apiKey: 'k', sender: 's' },
    });
  });
});

describe('the server', () => {
  it('answers that it is alive', async () => {
    const db = await withTestDb();
    const reply = await call(testApp(db), '/api/health');

    expect(reply.status).toBe(200);
    expect(reply.body).toEqual({ ok: true });
  });

  it('answers 404 in JSON, not in HTML', async () => {
    const db = await withTestDb();
    const reply = await call(testApp(db), '/api/nothing-here');

    expect(reply.status).toBe(404);
    expect(reply.contentType).toContain('application/json');
  });

  it('answers a broken body in JSON, without saying what it is made of', async () => {
    const db = await withTestDb();
    const reply = await call(testApp(db), '/api/auth/login', {
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

  it("trusts forwarded addresses from loopback only, not from anyone ('loopback', never true)", async () => {
    const db = await withTestDb();

    // Express keeps what app.set was given. A behavioural proof needs a socket
    // that is not from this machine, which this suite does not have; this pins
    // that the one-word swap to `true` — which trusts every X-Forwarded-For —
    // cannot slip through.
    expect(testApp(db).get('trust proxy')).toBe('loopback');
  });
});
