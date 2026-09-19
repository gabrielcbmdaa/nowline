import type { Mailer, OutgoingMail } from '../mail.js';

/**
 * The mailer every route test gets: nothing leaves the process, and the test
 * reads `sent` to see what would have. `failNext()` makes the next send throw,
 * which is how a route is shown to survive a provider that is down.
 */
export function recordingMailer(): { mailer: Mailer; sent: OutgoingMail[]; failNext(): void } {
  const sent: OutgoingMail[] = [];
  let failures = 0;
  return {
    sent,
    failNext() {
      failures += 1;
    },
    mailer: {
      async send(mail) {
        if (failures > 0) {
          failures -= 1;
          throw new Error('the recording mailer was told to fail');
        }
        sent.push(mail);
      },
    },
  };
}
