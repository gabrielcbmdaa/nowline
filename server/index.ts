import express from 'express';
import type { Db } from 'mongodb';
import { openDatabase } from './db.js';
import { loginRoute } from './routes/login.js';

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

  // Anything unmatched answers JSON: a client that gets HTML here would
  // fail while parsing, and the real cause would never reach the report.
  app.use((_request, response) => {
    response.status(404).json({ error: 'not found' });
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

// Only when run directly, never when imported by a test.
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  try {
    const { url, dbName, port } = readConfig();
    openDatabase(url, dbName)
      .then((db) => {
        createApp(db).listen(port, () => {
          console.log(`nowline server listening on ${port}`);
        });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Failed to start server: ${message}`);
        process.exit(1);
      });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}
