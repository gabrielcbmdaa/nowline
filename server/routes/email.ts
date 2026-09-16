import { ObjectId, type Db } from 'mongodb';
import { Router, type Request } from 'express';
import { LIMITS, TOO_MANY, countAttempt, ipOf } from '../attempts.js';
import { collections } from '../db.js';
import { identify } from '../identity.js';
import type { AppOptions } from '../index.js';
import { LINK_GONE, consumeLink, issueLink } from '../links.js';
import { sendOrLog } from '../mail.js';
import { confirmEmail, linkUrl } from '../messages.js';
import { findUserById } from '../users.js';

const NO_SESSION = { error: 'invalid credentials' };

/** Proving an address, and asking for the proof again. */
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
    const link = await consumeLink(db, body.token, ['verify']);
    if (!link) {
      response.status(410).json(LINK_GONE);
      return;
    }
    // Only while the address is still the account's. If it was released or
    // changed since the email went out, there is nothing left to confirm —
    // and this filter and the release's exclude each other.
    const result = await collections(db).users.updateOne(
      { _id: new ObjectId(link.userId), email: link.email },
      { $set: { verifiedAt: new Date() } },
    );
    if (result.matchedCount === 0) {
      response.status(410).json(LINK_GONE);
      return;
    }
    response.json({ confirmed: 'email' });
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
