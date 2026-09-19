import { type Collection, MongoClient, type Db, type ObjectId } from 'mongodb';

export type SessionRow = { tokenHash: string; userId: string; createdAt: Date };
export type UserRow = {
  _id?: ObjectId;
  /**
   * Normalized by `accounts.ts` before it is stored. `null` only for an account
   * whose address was released to someone else (`users.ts`); such an account
   * keeps its rows, its password and its sessions.
   */
  email: string | null;
  passwordHash: string;
  verifiedAt: Date | null;
  createdAt: Date;
};
export type LinkPurpose = 'verify' | 'reset' | 'change-email';
export type EmailLinkRow = {
  /** sha256 of the token, as sessions store theirs; the token itself is never stored. */
  tokenHash: string;
  userId: string;
  purpose: LinkPurpose;
  /** The address it went to; for change-email, the new one. */
  email: string;
  expiresAt: Date;
};
export type AttemptRow = { key: string; count: number; windowStartedAt: Date };

export function collections(db: Db) {
  return {
    users: db.collection<UserRow>('users'),
    sessions: db.collection<SessionRow>('sessions'),
    emailLinks: db.collection<EmailLinkRow>('emailLinks'),
    projects: db.collection('projects'),
    plans: db.collection('plans'),
    overrides: db.collection('overrides'),
    attempts: db.collection<AttemptRow>('attempts'),
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
    // An owner cannot have two rows with the same id. Without this, two
    // overlapping uploads of a new row can insert two documents, and the
    // conditional upsert in sync.ts has no way to fail when it must.
    await rows.createIndex({ userId: 1, id: 1 }, { unique: true });
  }
  // Partial: released accounts hold email: null, and a plain unique index
  // would allow only one of them.
  await c.users.createIndex(
    { email: 1 },
    { unique: true, partialFilterExpression: { email: { $type: 'string' } } },
  );
  // Code, not a manual step. New rows carry no username, and a unique index
  // treats a missing field as null: with this index in place the second
  // registration collides with the first and is told its address is taken.
  await dropIndexIfPresent(c.users, 'username_1');
  await c.sessions.createIndex({ tokenHash: 1 }, { unique: true });
  await c.emailLinks.createIndex({ tokenHash: 1 }, { unique: true });
  // Mongo removes an expired link on its own, within a minute; consumeLink
  // still checks expiresAt itself, for that minute.
  await c.emailLinks.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  // Issuing a link first deletes the earlier ones of that user and purpose.
  await c.emailLinks.createIndex({ userId: 1, purpose: 1 });
  await c.attempts.createIndex({ key: 1 }, { unique: true });
  // The longest window in attempts.ts is an hour. Without this, every IP that
  // ever made a call would leave a row behind for good.
  await c.attempts.createIndex({ windowStartedAt: 1 }, { expireAfterSeconds: 3600 });
  return db;
}

async function dropIndexIfPresent(collection: Collection<UserRow>, name: string): Promise<void> {
  try {
    await collection.dropIndex(name);
  } catch (error: unknown) {
    // 27 is "index not found", 26 "namespace not found" — a fresh database has
    // neither the index nor, before its first row, the collection. MongoDB 8.3
    // answers ok to both; 8.0, which production runs, throws.
    const code = (error as { code?: unknown }).code;
    if (code !== 26 && code !== 27) throw error;
  }
}

/**
 * Whether `error` is Mongo refusing a duplicate on the unique index over
 * `field`. Only the email index may be read as "taken": any other duplicate
 * is this server's bug, and a 500 in the log is where it belongs.
 */
export function isDuplicateKeyOn(error: unknown, field: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, keyPattern } = error as { code?: unknown; keyPattern?: unknown };
  if (code !== 11000) return false;
  return typeof keyPattern === 'object' && keyPattern !== null && field in keyPattern;
}

export async function openDatabase(url: string, dbName: string): Promise<Db> {
  const client = new MongoClient(url);
  await client.connect();
  return connect(client.db(dbName));
}
