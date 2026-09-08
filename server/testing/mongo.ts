import { MongoClient, type Db } from 'mongodb';

const TEST_DB = 'nowline_test';
const TEST_HOST = 'mongodb://127.0.0.1:27017';

/**
 * 27017 is always this Mac; 27018 is always the tunnel to production. A test
 * clears collections, so pointing one at the wrong port destroys real data.
 * The check is deliberately exact rather than clever.
 */
export function assertSafeTestTarget(url: string, dbName: string): void {
  if (dbName !== TEST_DB) {
    throw new Error(`Tests may only use "${TEST_DB}", never "${dbName}"`);
  }
  if (url !== TEST_HOST) {
    throw new Error(`Tests may only reach ${TEST_HOST}, never "${url}"`);
  }
}

let client: MongoClient | null = null;
let db: Db | null = null;

export async function withTestDb(): Promise<Db> {
  assertSafeTestTarget(TEST_HOST, TEST_DB);
  if (!client) {
    client = new MongoClient(TEST_HOST);
    await client.connect();
    db = client.db(TEST_DB);
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
  }
}
