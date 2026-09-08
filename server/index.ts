import express from 'express';

/**
 * The app is built without listening, so a test can ask it for answers
 * without occupying a port. The process below is what binds one.
 */
export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_request, response) => {
    response.json({ ok: true });
  });

  // Anything unmatched answers JSON: a client that gets HTML here would
  // fail while parsing, and the real cause would never reach the report.
  app.use((_request, response) => {
    response.status(404).json({ error: 'not found' });
  });

  return app;
}

const PORT = Number(process.env.PORT ?? 3001);

// Only when run directly, never when imported by a test.
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  createApp().listen(PORT, () => {
    console.log(`nowline server listening on ${PORT}`);
  });
}
