import express from 'express';
import type { Db } from 'mongodb';
import { loginRoute } from './routes/login.js';
import { syncRoute } from './routes/sync.js';

/**
 * The app is built without listening, so a test can ask it for answers
 * without occupying a port. The process below is what binds one.
 */
export function createApp(db: Db): express.Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  app.use(loginRoute(db));
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

export function readConfig(): { url: string; dbName: string; port: number } {
  const url = process.env.MONGO_URL;
  const dbName = process.env.MONGO_DB;
  if (!url || !dbName) {
    // Never default the database name: the production one is a plausible guess,
    // and a server that picks its own database picks the wrong one silently.
    throw new Error('Set MONGO_URL and MONGO_DB before starting the server');
  }
  return { url, dbName, port: Number(process.env.PORT ?? 3001) };
}
