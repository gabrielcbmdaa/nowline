import type { Db } from 'mongodb';
import { collections } from './db.js';

/**
 * How often a stranger may knock. One module for every route, so the rules
 * are a table and not a hunt, and the counter is written once.
 */

export type Limit = { max: number; windowMinutes: number };

/**
 * The table of the design's section 9. Per address where a person is the
 * target, per IP where the server is; the IP limit on login is wide so a
 * household with several accounts fits behind one address. Nothing here is
 * longer than an hour, which is what the TTL on the collection assumes.
 */
export const LIMITS = {
  login: { max: 5, windowMinutes: 15 },
  loginIp: { max: 30, windowMinutes: 15 },
  register: { max: 5, windowMinutes: 60 },
  reset: { max: 3, windowMinutes: 60 },
  resetIp: { max: 10, windowMinutes: 60 },
  link: { max: 10, windowMinutes: 60 },
  changeEmail: { max: 3, windowMinutes: 60 },
  sendConfirmation: { max: 3, windowMinutes: 60 },
} as const satisfies Record<string, Limit>;

export const TOO_MANY = { error: 'too many attempts' };

/**
 * Count one attempt against `key` and say whether the key is now over its
 * limit. One operation, because a check followed by an increment is not a
 * limit: twelve guesses fired together all read "under the limit" before any
 * of them wrote. `$inc` is atomic; the `if` that used to precede it was not.
 * The counter goes up when an attempt starts, not when it is known to have
 * failed — a success calls `forgetAttempts` — so it only ever grows on
 * attempts that did not get in.
 */
export async function countAttempt(db: Db, key: string, limit: Limit): Promise<boolean> {
  const cutoff = new Date(Date.now() - limit.windowMinutes * 60_000);
  await collections(db).attempts.deleteOne({ key, windowStartedAt: { $lt: cutoff } });

  const row = await collections(db).attempts.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $setOnInsert: { windowStartedAt: new Date() } },
    { upsert: true, returnDocument: 'after' },
  );
  return (row?.count ?? 1) > limit.max;
}

export async function forgetAttempts(db: Db, key: string): Promise<void> {
  await collections(db).attempts.deleteOne({ key });
}

/**
 * The address a per-IP key counts against. `request.ip` honours
 * `X-Forwarded-For` only from a trusted proxy (`trust proxy` in index.ts), and
 * is undefined once a socket is gone; a missing address still needs a key.
 */
export function ipOf(request: { ip: string | undefined }): string {
  return request.ip ?? 'unknown';
}
