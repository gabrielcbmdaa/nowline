import { ObjectId, type Db, type WithId } from 'mongodb';
import { collections, type UserRow } from './db.js';

/**
 * The Mongo side of accounts.ts: what the routes ask about a user row that
 * is not one query long.
 */

/**
 * A session names its account by the string of its `_id`; a string that is
 * not one names nobody, and `new ObjectId` would throw on it.
 */
export async function findUserById(db: Db, userId: string): Promise<WithId<UserRow> | null> {
  if (!ObjectId.isValid(userId)) return null;
  return collections(db).users.findOne({ _id: new ObjectId(userId) });
}
