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

/**
 * How long an unconfirmed account keeps its address from someone who wants
 * it. Measured from `createdAt`, which nobody can refresh — a confirmation
 * link can be resent for ever, so its age would prove nothing.
 */
export const STALE_AFTER_MS = 24 * 3600_000;

function staleHolderOf(email: string) {
  return { email, verifiedAt: null, createdAt: { $lt: new Date(Date.now() - STALE_AFTER_MS) } };
}

/**
 * Closes the crack in the design's section 8. Someone registers an address
 * before its owner does; after a day unconfirmed, nothing could ever reach
 * the real owner again. So the address goes to whoever asks for it next, and
 * the account that held it keeps its rows, its password and its sessions, and
 * loses only the address. No row ever reaches another person.
 *
 * A confirmation excludes this by its filter and this excludes a
 * confirmation by its own: whichever runs second finds nothing to match.
 */
export async function releaseStaleHolder(db: Db, email: string): Promise<boolean> {
  const result = await collections(db).users.updateOne(staleHolderOf(email), { $set: { email: null } });
  return result.modifiedCount === 1;
}

/**
 * Whether an account holds this address and could not be made to give it up.
 * A courtesy for answering early; the unique index is what decides.
 */
export async function addressIsTaken(db: Db, email: string): Promise<boolean> {
  const holder = await collections(db).users.findOne({ email });
  if (!holder) return false;
  return holder.verifiedAt !== null || holder.createdAt.getTime() >= Date.now() - STALE_AFTER_MS;
}
