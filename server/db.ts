import { MongoClient, type Db } from 'mongodb';

export type SessionRow = { tokenHash: string; userId: string; createdAt: Date };
export type UserRow = { _id?: unknown; username: string; passwordHash: string };
export type AttemptRow = { key: string; failures: number; firstFailureAt: Date };

export function collections(db: Db) {
  return {
    users: db.collection<UserRow>('users'),
    sessions: db.collection<SessionRow>('sessions'),
    projects: db.collection('projects'),
    plans: db.collection('plans'),
    overrides: db.collection('overrides'),
    loginAttempts: db.collection<AttemptRow>('loginAttempts'),
  };
}

/**
 * Creating the indexes is part of connecting, not a separate migration step:
 * "give me what changed since Tuesday" without { userId, serverUpdatedAt }
 * walks every row to return three, and nothing would ever tell us.
 */
export async function connect(db: Db): Promise<Db> {
  const c = collections(db);
  for (const rows of [c.projects, c.plans, c.overrides]) {
    await rows.createIndex({ userId: 1, serverUpdatedAt: 1 });
  }
  await c.users.createIndex({ username: 1 }, { unique: true });
  await c.sessions.createIndex({ tokenHash: 1 }, { unique: true });
  await c.loginAttempts.createIndex({ key: 1 }, { unique: true });
  return db;
}

export async function openDatabase(url: string, dbName: string): Promise<Db> {
  const client = new MongoClient(url);
  await client.connect();
  return connect(client.db(dbName));
}
