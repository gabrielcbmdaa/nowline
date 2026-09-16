import express from 'express';
import type { Db } from 'mongodb';
import type { MailConfig, Mailer } from './mail.js';
import { loginRoute } from './routes/login.js';
import { sessionRoute } from './routes/session.js';
import { syncRoute } from './routes/sync.js';

/** What the routes need beyond the database, and the tests replace. */
export type AppOptions = { mailer: Mailer; publicUrl: string };

/**
 * The app is built without listening, so a test can ask it for answers
 * without occupying a port. The process below is what binds one. The routes
 * that send email get the mailer from here, never from a module: that is the
 * seam the tests use to read what would have been sent.
 */
export function createApp(db: Db, _options: AppOptions): express.Express {
  const app = express();
  // Trust X-Forwarded-For only when the connection itself comes from this
  // machine, which is where nginx connects from. `true` would let anyone send
  // the header from outside with a made-up address and dodge every per-IP limit.
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.use(loginRoute(db));
  app.use(sessionRoute(db));
  app.use(syncRoute(db));

  // Anything unmatched answers JSON: a client that gets HTML here would
  // fail while parsing, and the real cause would never reach the report.
  app.use((_request, response) => {
    response.status(404).json({ error: 'not found' });
  });

  // Four parameters on purpose: that is how Express tells an error handler from
  // ordinary middleware. Drop `next` and this silently stops catching anything.
  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    // A malformed body is the caller's fault and says nothing worth reporting.
    // Anything else is this server breaking, and the owner should see it in the
    // process log — where it is his, not in the reply, where it is everyone's.
    const status = error instanceof SyntaxError ? 400 : 500;
    if (status === 500) console.error(error);
    response.status(status).json({ error: status === 400 ? 'bad request' : 'server error' });
  });

  return app;
}

export type Config = {
  url: string;
  dbName: string;
  port: number;
  publicUrl: string;
  mail: MailConfig;
};

/**
 * No variable has a default, for the same reason MONGO_DB never had one: a
 * server that picks its own database picks the wrong one silently, and one
 * that picks its own mail transport falls silent without anyone noticing.
 */
export function readConfig(): Config {
  const url = process.env.MONGO_URL;
  const dbName = process.env.MONGO_DB;
  if (!url || !dbName) {
    throw new Error('Set MONGO_URL and MONGO_DB before starting the server');
  }
  // Every emailed link starts with this, so a trailing slash would double up.
  const publicUrl = required('PUBLIC_URL').replace(/\/+$/, '');
  const transport = required('MAIL_TRANSPORT');
  let mail: MailConfig;
  if (transport === 'zavu') {
    mail = { transport, apiKey: required('MAIL_API_KEY'), sender: required('MAIL_SENDER') };
  } else if (transport === 'console') {
    mail = { transport };
  } else {
    throw new Error(`MAIL_TRANSPORT must be "zavu" or "console", not "${transport}"`);
  }
  return { url, dbName, port: Number(process.env.PORT ?? 3001), publicUrl, mail };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before starting the server`);
  return value;
}
