import { randomBytes } from 'node:crypto';
import type { Db, WithId } from 'mongodb';
import { collections, type EmailLinkRow, type LinkPurpose } from './db.js';
import { fingerprint } from './identity.js';

/**
 * An emailed link is a token, stored as a fingerprint the way a session is,
 * that one press turns into an action: confirming an address, or choosing a
 * new password. This file issues and consumes them; what each purpose does
 * is the route's business.
 */

const BYTES = 32;

/**
 * A reset takes an account over, so it lives an hour. The other two only
 * prove an address, and a day gives the email time to be read.
 */
export const LINK_LIFETIME_MS: Record<LinkPurpose, number> = {
  reset: 3600_000,
  verify: 24 * 3600_000,
  'change-email': 24 * 3600_000,
};

export async function issueLink(
  db: Db,
  link: { userId: string; purpose: LinkPurpose; email: string },
): Promise<string> {
  // The latest email is the one that works: earlier links for the same
  // purpose go first. Two issued in the same instant can both survive; both
  // went to the same address.
  await collections(db).emailLinks.deleteMany({ userId: link.userId, purpose: link.purpose });
  const token = randomBytes(BYTES).toString('hex');
  await collections(db).emailLinks.insertOne({
    tokenHash: fingerprint(token),
    userId: link.userId,
    purpose: link.purpose,
    email: link.email,
    expiresAt: new Date(Date.now() + LINK_LIFETIME_MS[link.purpose]),
  });
  // The caller gets the only copy in the clear, for the email.
  return token;
}

/**
 * One operation, for the same reason `saveRow` decides in its filter: two
 * presses of one link cannot both succeed. `expiresAt` is in the filter as
 * well as in a TTL index, because Mongo's TTL monitor runs every 60 seconds
 * and a link that expired a minute ago must not get through.
 */
export async function consumeLink(
  db: Db,
  token: string,
  purposes: readonly LinkPurpose[],
): Promise<WithId<EmailLinkRow> | null> {
  return collections(db).emailLinks.findOneAndDelete({
    tokenHash: fingerprint(token),
    purpose: { $in: purposes },
    expiresAt: { $gt: new Date() },
  });
}

/**
 * One answer for a link that is used, expired, for another purpose, or never
 * existed: telling them apart would tell a stranger which strings were links.
 */
export const LINK_GONE = { error: 'link expired or used' };
