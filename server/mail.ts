/**
 * The only file that knows a provider exists. Routes receive a `Mailer` and
 * never see a URL or a key, so changing provider is rewriting this file and
 * two environment variables, and nothing else.
 */

export type OutgoingMail = { to: string; subject: string; text: string };
export type Mailer = { send(mail: OutgoingMail): Promise<void> };
export type MailConfig =
  | { transport: 'zavu'; apiKey: string; sender: string }
  | { transport: 'console' };

const ZAVU_MESSAGES = 'https://api.zavu.dev/v1/messages';
const SEND_TIMEOUT_MS = 10_000;

/**
 * The request the owner's own curl made on 2026-09-15 and Gmail accepted into
 * the inbox, copied — Zavu's public docs show the sender header only in a
 * general example. Zavu answers 202 with `status: "queued"`: accepted, not
 * delivered. Any 2xx counts as sent, and nobody waits for delivery.
 */
export function zavuMailer(config: { apiKey: string; sender: string }): Mailer {
  return {
    async send({ to, subject, text }) {
      const response = await fetch(ZAVU_MESSAGES, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          'Zavu-Sender': config.sender,
        },
        body: JSON.stringify({ to, channel: 'email', subject, text }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      // The status and nothing else: this message ends in the process log,
      // and the key must not.
      if (!response.ok) throw new Error(`Zavu answered ${response.status} to a send`);
    },
  };
}

/**
 * Development: the whole email on the terminal, link included, which is how
 * a link gets into a browser on a machine with no mailbox.
 */
export function consoleMailer(): Mailer {
  return {
    async send({ to, subject, text }) {
      console.log(`\n--- email to ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
    },
  };
}

export function mailerFor(config: MailConfig): Mailer {
  return config.transport === 'zavu' ? zavuMailer(config) : consoleMailer();
}

/**
 * Send, and turn a failure into a log line rather than a thrown error: the
 * caller either has already answered or answers the same either way, and the
 * owner reads the process log. Says whether the mail went.
 */
export async function sendOrLog(mailer: Mailer, mail: OutgoingMail): Promise<boolean> {
  try {
    await mailer.send(mail);
    return true;
  } catch (error: unknown) {
    console.error(`Could not send "${mail.subject}" to ${mail.to}:`, messageOf(error));
    return false;
  }
}

/**
 * Work that runs after a reply has gone. Nothing it throws can reach the
 * reply any more, so a failure becomes a log line instead of a rejected
 * promise nobody waits for.
 */
export async function afterReply(work: () => Promise<void>): Promise<void> {
  try {
    await work();
  } catch (error: unknown) {
    console.error('After the reply:', messageOf(error));
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
