import { ObjectId, type Db } from 'mongodb';
import { Router } from 'express';
import { checkPassword, normalizeEmail, refusalFor } from '../accounts.js';
import { LIMITS, TOO_MANY, countAttempt, forgetAttempts, ipOf } from '../attempts.js';
import { collections } from '../db.js';
import { issueToken, revokeAllFor } from '../identity.js';
import type { AppOptions } from '../index.js';
import { LINK_GONE, consumeLink, issueLink } from '../links.js';
import { afterReply, sendOrLog } from '../mail.js';
import { linkUrl, resetPassword } from '../messages.js';
import { hashPassword } from '../passwords.js';

/** Forgot password: ask for a link by email, then use it to choose a new password. */
export function recoveryRoute(db: Db, options: AppOptions): Router {
  const router = Router();

  router.post('/api/auth/request-reset', async (request, response) => {
    const body = request.body as { email?: unknown } | null | undefined;
    if (typeof body?.email !== 'string') {
      response.status(400).json({ error: 'bad request' });
      return;
    }
    const email = normalizeEmail(body.email);
    const overByEmail = await countAttempt(db, `reset:${email}`, LIMITS.reset);
    const overByIp = await countAttempt(db, `reset-ip:${ipOf(request)}`, LIMITS.resetIp);
    if (overByEmail || overByIp) {
      response.status(429).json(TOO_MANY);
      return;
    }

    // The reply goes before anything is looked up, and is the same for every
    // address. Looking up, issuing and sending afterwards means that neither
    // the body nor the time taken says whether this address has an account.
    // No test measures that time — one would be flaky — so the reason lives here.
    response.json({});
    void afterReply(async () => {
      const user = await collections(db).users.findOne({ email });
      // A reset takes an account over, so it only goes to an address someone
      // has proved they read. An unconfirmed one may be a typo, or a stranger's.
      if (!user || user.verifiedAt === null) return;
      const token = await issueLink(db, { userId: String(user._id), purpose: 'reset', email });
      await sendOrLog(options.mailer, { to: email, ...resetPassword(linkUrl(options.publicUrl, 'reset', token)) });
    });
  });

  router.post('/api/auth/reset', async (request, response) => {
    const body = request.body as { token?: unknown; password?: unknown } | null | undefined;
    if (typeof body?.token !== 'string' || typeof body.password !== 'string') {
      response.status(400).json({ error: 'bad request' });
      return;
    }
    // Before the link is consumed: a password that is too short must not burn it.
    const problem = checkPassword(body.password);
    if (problem) {
      response.status(400).json(refusalFor(problem));
      return;
    }
    if (await countAttempt(db, `link-ip:${ipOf(request)}`, LIMITS.link)) {
      response.status(429).json(TOO_MANY);
      return;
    }
    const link = await consumeLink(db, body.token, ['reset']);
    if (!link) {
      response.status(410).json(LINK_GONE);
      return;
    }

    const passwordHash = await hashPassword(body.password);
    await collections(db).users.updateOne({ _id: new ObjectId(link.userId) }, { $set: { passwordHash } });
    // Whoever asked for a reset no longer trusts where the account is signed
    // in: every session ends, and this device gets a fresh one.
    await revokeAllFor(db, link.userId);
    await forgetAttempts(db, `login:${link.email}`);
    response.json({ token: await issueToken(db, link.userId), userId: link.userId });
  });

  return router;
}
