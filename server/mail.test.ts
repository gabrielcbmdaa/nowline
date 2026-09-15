import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterReply, consoleMailer, mailerFor, sendOrLog, zavuMailer } from './mail.js';

const mail = { to: 'ana@example.com', subject: 'Hello', text: 'Body' };
const accepted = () =>
  new Response(JSON.stringify({ message: { status: 'queued' } }), { status: 202 });

describe('zavuMailer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("makes the request the owner's curl made on 2026-09-15", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(accepted());
    vi.stubGlobal('fetch', fetchSpy);

    await zavuMailer({ apiKey: 'k-secret', sender: 'sender-id' }).send(mail);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.zavu.dev/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: 'Bearer k-secret',
      'Content-Type': 'application/json',
      'Zavu-Sender': 'sender-id',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      to: 'ana@example.com',
      channel: 'email',
      subject: 'Hello',
      text: 'Body',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('takes 202 queued as sent: accepted is all Zavu promises', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(accepted()));

    await expect(zavuMailer({ apiKey: 'k', sender: 's' }).send(mail)).resolves.toBeUndefined();
  });

  it('throws on a refusal, naming the status and never the key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 401 })));

    const failure: unknown = await zavuMailer({ apiKey: 'k-secret', sender: 's' })
      .send(mail)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/401/);
    expect((failure as Error).message).not.toContain('k-secret');
  });
});

describe('consoleMailer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('prints the whole email, link included, and sends nothing', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await consoleMailer().send({ ...mail, text: 'Open https://nowline.test/#confirm=abc' });

    const printed = log.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(printed).toContain('ana@example.com');
    expect(printed).toContain('Hello');
    expect(printed).toContain('https://nowline.test/#confirm=abc');
  });

  it('is what mailerFor builds for console, while zavu goes to the network', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetchSpy = vi.fn().mockResolvedValue(accepted());
    vi.stubGlobal('fetch', fetchSpy);

    await mailerFor({ transport: 'console' }).send(mail);
    expect(log).toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    await mailerFor({ transport: 'zavu', apiKey: 'k', sender: 's' }).send(mail);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe('sendOrLog and afterReply', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says true when the mail went', async () => {
    const mailer = { send: vi.fn().mockResolvedValue(undefined) };

    expect(await sendOrLog(mailer, mail)).toBe(true);
  });

  it('turns a failed send into a log line and false', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const mailer = { send: vi.fn().mockRejectedValue(new Error('provider down')) };

    expect(await sendOrLog(mailer, mail)).toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0])).toContain('provider down');
  });

  it('never rejects: a failure after the reply is a log line', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(afterReply(() => Promise.reject(new Error('late failure')))).resolves.toBeUndefined();
    expect(String(error.mock.calls[0])).toContain('late failure');
  });
});
