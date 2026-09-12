import { openDatabase } from './db.js';
import { createApp, readConfig } from './index.js';

/**
 * The only job of this file is to start the process, and nothing imports it —
 * which is the whole point. `index.ts` used to decide whether to listen by
 * reading `process.argv[1]`, and that is a guess about how the process was
 * launched: true under `node index.js`, false under PM2, whose fork mode puts
 * its own `ProcessContainerFork.js` there. On 2026-09-12 that guess left a
 * process online and silent on the VPS, holding no port, for half an hour.
 * A file that always starts cannot be wrong about whether it should.
 */
function start(): void {
  const { url, dbName, port } = readConfig();
  openDatabase(url, dbName)
    .then((db) => {
      // 127.0.0.1 on purpose, as the spec's deployment section requires:
      // nginx is the only thing that talks to the world, and a process that
      // binds every interface is reachable the moment a firewall rule moves.
      createApp(db).listen(port, '127.0.0.1', () => {
        console.log(`nowline server listening on 127.0.0.1:${port}`);
      });
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed to start server: ${message}`);
      process.exit(1);
    });
}

try {
  start();
} catch (error: unknown) {
  // `readConfig` throws synchronously when a variable is missing, and a stack
  // trace for "you forgot MONGO_DB" buries the one line worth reading.
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
