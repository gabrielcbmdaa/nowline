import { createHash } from 'node:crypto';
import { MongoClient, type Db } from 'mongodb';
import { expect } from 'vitest';

const TEST_HOST = 'mongodb://127.0.0.1:27017';

/** Exact match only — a prefix test once let a hostile URL through. */
const ALLOWED_DB = /^nowline_test(_[a-z0-9_]+)?$/;

/**
 * 27017 is always this Mac; 27018 is always the tunnel to production. A test
 * clears collections, so pointing one at the wrong port destroys real data.
 * The check is deliberately exact rather than clever.
 */
export function assertSafeTestTarget(url: string, dbName: string): void {
  if (!ALLOWED_DB.test(dbName)) {
    throw new Error(
      `Tests may only use "nowline_test" or "nowline_test_<suffix>", never "${dbName}"`,
    );
  }
  if (url !== TEST_HOST) {
    throw new Error(`Tests may only reach ${TEST_HOST}, never "${url}"`);
  }
}

/**
 * One database per test file so parallel workers do not drop each other's
 * collections. The suffix is a hash of vitest's test path — stable across
 * runs and unique per file as long as two files do not share the same path.
 */
function deriveTestDbName(): string {
  const testPath = expect.getState().testPath;
  if (!testPath) {
    throw new Error('withTestDb() must be called from a vitest test file');
  }
  const suffix = createHash('sha256').update(testPath).digest('hex').slice(0, 16);
  return `nowline_test_${suffix}`;
}

let client: MongoClient | null = null;
let db: Db | null = null;
let dbName: string | null = null;

export async function withTestDb(): Promise<Db> {
  if (!dbName) {
    dbName = deriveTestDbName();
  }
  assertSafeTestTarget(TEST_HOST, dbName);
  if (!client) {
    client = new MongoClient(TEST_HOST);
    await client.connect();
    db = client.db(dbName);
  }
  return db!;
}

export async function clearTestDb(database: Db): Promise<void> {
  assertSafeTestTarget(TEST_HOST, database.databaseName);
  const names = await database.listCollections().toArray();
  for (const { name } of names) {
    await database.collection(name).drop();
  }
}

export async function closeTestDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    dbName = null;
  }
}
