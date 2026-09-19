import type { Express } from 'express';
import type { Db } from 'mongodb';
import { createApp } from '../index.js';
import type { Mailer } from '../mail.js';
import { recordingMailer } from './mail.js';

/** Not a real origin, so a test that finds it in a link knows the link came from configuration. */
export const TEST_PUBLIC_URL = 'https://nowline.test';

/** The app the way the tests build it: a recording mailer unless the test wants to read one of its own. */
export function testApp(db: Db, mailer?: Mailer): Express {
  return createApp(db, { mailer: mailer ?? recordingMailer().mailer, publicUrl: TEST_PUBLIC_URL });
}
