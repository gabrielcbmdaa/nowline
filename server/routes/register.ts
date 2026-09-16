import type { Db } from 'mongodb';
import { Router } from 'express';
import { checkEmail, checkPassword, normalizeEmail, refusalFor } from '../accounts.js';
import { LIMITS, TOO_MANY, countAttempt, ipOf } from '../attempts.js';
import { collections, isDuplicateKeyOn } from '../db.js';
import { issueToken } from '../identity.js';
import type { AppOptions } from '../index.js';
import { issueLink } from '../links.js';
import { sendOrLog } from '../mail.js';
import { confirmEmail, linkUrl } from '../messages.js';
import { hashPassword } from '../passwords.js';
import { releaseStaleHolder } from '../users.js';

export function registerRoute(db: Db, options: AppOptions): Router {
  const router = Router();

  router.post('/api/auth/register', async (request, response) => {
    const body = request.body as { email?: unknown; password?: unknown } | null | undefined;
    if (typeof body?.email !== 'string' || typeof body.password !== 'string') {
      response.status(400).json({ error: 'bad request' });
      return;
    }
    const email = normalizeEmail(body.email);
    const emailProblem = checkEmail(email);
    if (emailProblem) {
      response.status(400).json({ error: emailProblem });
      return;
    }
    const passwordProblem = checkPassword(body.password);
    if (passwordProblem) {
      response.status(400).json(refusalFor(passwordProblem));
      return;
    }

    // Counted only now. A refusal above cost nothing — no bcrypt, no email —
    // and counting it would lock a person out for an hour after five typos.
    if (await countAttempt(db, `register-ip:${ipOf(request)}`, LIMITS.register)) {
      response.status(429).json(TOO_MANY);
      return;
    }

    const passwordHash = await hashPassword(body.password);
    await releaseStaleHolder(db, email);
    let userId: string;
    try {
      const { insertedId } = await collections(db).users.insertOne({
        email,
        passwordHash,
        verifiedAt: null,
        createdAt: new Date(),
      });
      userId = String(insertedId);
    } catch (error: unknown) {
      // Only the email index means "taken". Any other duplicate is this
      // server's bug, and the error handler logs it as a 500.
      if (!isDuplicateKeyOn(error, 'email')) throw error;
      response.status(409).json({ error: 'email taken' });
      return;
    }

    // Verify without blocking: the account works at once, and the address is
    // confirmed whenever the link is opened. A send that fails leaves the
    // account in place and says so; the account tab offers to send again.
    const token = await issueToken(db, userId);
    const link = linkUrl(options.publicUrl, 'confirm', await issueLink(db, { userId, purpose: 'verify', email }));
    const confirmationSent = await sendOrLog(options.mailer, { to: email, ...confirmEmail(link) });
    response.status(201).json({ token, userId, confirmationSent });
  });

  return router;
}
