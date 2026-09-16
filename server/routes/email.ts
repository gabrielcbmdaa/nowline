import { ObjectId, type Db, type WithId } from 'mongodb';
import { Router, type Request } from 'express';
import { checkEmail, normalizeEmail } from '../accounts.js';
import { LIMITS, TOO_MANY, countAttempt, ipOf } from '../attempts.js';
import { collections, isDuplicateKeyOn, type UserRow } from '../db.js';
import { identify } from '../identity.js';
import type { AppOptions } from '../index.js';
import { LINK_GONE, consumeLink, issueLink } from '../links.js';
import { sendOrLog } from '../mail.js';
import { confirmEmail, confirmNewEmail, emailChanged, linkUrl } from '../messages.js';
import { verifyPassword } from '../passwords.js';
import { addressIsTaken, findUserById, releaseStaleHolder } from '../users.js';

const NO_SESSION = { error: 'invalid credentials' };
const TAKEN = { error: 'email taken' };

/** Proving an address, changing it, and asking for the proof again. */
export function emailRoute(db: Db, options: AppOptions): Router {
  const router = Router();

  /** The account behind the request's session, or null — a session whose account is gone is no session. */
  async function accountOf(request: Request) {
    const userId = await identify(db, request.headers.authorization);
    return userId === null ? null : findUserById(db, userId);
  }

  router.post('/api/auth/confirm', async (request, response) => {
    const body = request.body as { token?: unknown } | null | undefined;
    if (typeof body?.token !== 'string') {
      response.status(400).json({ error: 'bad request' });
      return;
    }
    if (await countAttempt(db, `link-ip:${ipOf(request)}`, LIMITS.link)) {
      response.status(429).json(TOO_MANY);
      return;
    }
    const link = await consumeLink(db, body.token, ['verify', 'change-email']);
    if (!link) {
      response.status(410).json(LINK_GONE);
      return;
    }
    const users = collections(db).users;
    const _id = new ObjectId(link.userId);

    if (link.purpose === 'verify') {
      // Only while the address is still the account's. If it was released or
      // changed since the email went out, there is nothing left to confirm —
      // and this filter and the release's exclude each other.
      const result = await users.updateOne({ _id, email: link.email }, { $set: { verifiedAt: new Date() } });
      if (result.matchedCount === 0) {
        response.status(410).json(LINK_GONE);
        return;
      }
      response.json({ confirmed: 'email' });
      return;
    }

    // Without this second caller, change-email's early check would accept an
    // address that this step then refuses.
    await releaseStaleHolder(db, link.email);
    let before: WithId<UserRow> | null;
    try {
      before = await users.findOneAndUpdate(
        { _id },
        { $set: { email: link.email, verifiedAt: new Date() } },
        { returnDocument: 'before' },
      );
    } catch (error: unknown) {
      if (!isDuplicateKeyOn(error, 'email')) throw error;
      response.status(409).json(TAKEN);
      return;
    }
    if (!before) {
      response.status(410).json(LINK_GONE);
      return;
    }
    // Every other link went to an address that is no longer this account's.
    await collections(db).emailLinks.deleteMany({ userId: link.userId });
    response.json({ confirmed: 'new-email' });

    // After the reply, and only to an address someone had proved they read:
    // a notice never goes to a typo or to a stranger.
    const oldAddress = before.email;
    if (oldAddress !== null && before.verifiedAt !== null) {
      void sendOrLog(options.mailer, { to: oldAddress, ...emailChanged(link.email) });
    }
  });

  router.post('/api/auth/change-email', async (request, response) => {
    const user = await accountOf(request);
    if (!user) {
      response.status(401).json(NO_SESSION);
      return;
    }
    const body = request.body as { email?: unknown; password?: unknown } | null | undefined;
    if (typeof body?.email !== 'string' || typeof body.password !== 'string') {
      response.status(400).json({ error: 'bad request' });
      return;
    }
    const email = normalizeEmail(body.email);
    const problem = checkEmail(email);
    if (problem) {
      response.status(400).json({ error: problem });
      return;
    }
    if (email === user.email) {
      response.status(400).json({ error: 'same email' });
      return;
    }

    const userId = String(user._id);
    // Counted before the password is compared, as login counts before bcrypt:
    // otherwise a signed-in device in the wrong hands could guess the password
    // here without limit.
    if (await countAttempt(db, `change-email:${userId}`, LIMITS.changeEmail)) {
      response.status(429).json(TOO_MANY);
      return;
    }
    // The current password, because an unlocked phone in someone else's hands
    // must not move this account's recovery to their inbox. 403 and never 401:
    // the client signs a device out on any 401.
    if (!(await verifyPassword(body.password, user.passwordHash))) {
      response.status(403).json({ error: 'wrong password' });
      return;
    }
    // A courtesy: the unique index decides when the link is opened.
    if (await addressIsTaken(db, email)) {
      response.status(409).json(TAKEN);
      return;
    }

    const token = await issueLink(db, { userId, purpose: 'change-email', email });
    const link = linkUrl(options.publicUrl, 'confirm', token);
    response.json({ sent: await sendOrLog(options.mailer, { to: email, ...confirmNewEmail(link) }) });
  });

  router.post('/api/auth/send-confirmation', async (request, response) => {
    const user = await accountOf(request);
    if (!user) {
      response.status(401).json(NO_SESSION);
      return;
    }
    if (user.email === null) {
      response.status(409).json({ error: 'no email' });
      return;
    }
    if (user.verifiedAt !== null) {
      response.status(409).json({ error: 'already confirmed' });
      return;
    }
    const userId = String(user._id);
    if (await countAttempt(db, `confirm-send:${userId}`, LIMITS.sendConfirmation)) {
      response.status(429).json(TOO_MANY);
      return;
    }
    const token = await issueLink(db, { userId, purpose: 'verify', email: user.email });
    const link = linkUrl(options.publicUrl, 'confirm', token);
    response.json({ sent: await sendOrLog(options.mailer, { to: user.email, ...confirmEmail(link) }) });
  });

  return router;
}
