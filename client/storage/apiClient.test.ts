// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { confirmLink, isFailure, login, logout, register, requestReset, resetPassword, sync } from './apiClient';

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  });

describe('apiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands back the token the server issued, with the account it belongs to', async () => {
    vi.stubGlobal('fetch', reply(200, { token: 'abc', userId: 'u1' }));
    expect(await login('gabriel', 'a-long-password')).toEqual({ token: 'abc', userId: 'u1' });
  });

  it('refuses a token that comes without its account', async () => {
    // The device stores the token and its account as one pair. Half a pair is
    // a token it could not tell apart from somebody else's.
    vi.stubGlobal('fetch', reply(200, { token: 'abc' }));
    expect(await login('gabriel', 'a-long-password')).toEqual({ failed: true, kind: 'refused', status: 200, detail: null });

    // Half a pair, too: an account that is not a string names no account.
    vi.stubGlobal('fetch', reply(200, { token: 'abc', userId: 42 }));
    expect(await login('gabriel', 'a-long-password')).toEqual({ failed: true, kind: 'refused', status: 200, detail: null });
  });

  it('calls the path the app is served from, never another origin', async () => {
    const fetcher = reply(200, { token: 'abc' });
    vi.stubGlobal('fetch', fetcher);

    await login('gabriel', 'a-long-password');

    // Relative on purpose: same origin in development and in production.
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/login');
  });

  it('tells a wrong password apart from a server that is not there', async () => {
    vi.stubGlobal('fetch', reply(401, { error: 'invalid credentials' }));
    expect(await login('gabriel', 'wrong')).toEqual({
      failed: true,
      kind: 'unauthorized',
      status: 401,
      detail: { error: 'invalid credentials' },
    });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await login('gabriel', 'whatever')).toEqual({ failed: true, kind: 'offline', status: null, detail: null });
  });

  it('sends the token in the header sync expects', async () => {
    const fetcher = reply(200, {
      serverTime: 'T',
      changes: { projects: [], plans: [], overrides: [] },
      rejected: [],
    });
    vi.stubGlobal('fetch', fetcher);

    await sync('the-token', null, { projects: [], plans: [], overrides: [] });

    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer the-token');
  });

  it('reports an expired token as unauthorized rather than as a reply', async () => {
    vi.stubGlobal('fetch', reply(401, { error: 'invalid credentials' }));
    const result = await sync('stale', null, { projects: [], plans: [], overrides: [] });
    expect(isFailure(result) && result.kind).toBe('unauthorized');
  });

  it('treats a 200 that is not JSON as a server it does not recognise', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      }),
    );

    // The error page the dev server serves for a malformed body is HTML. A
    // caller that trusted this would carry `undefined` into storage.
    expect(await login('gabriel', 'a-long-password')).toEqual({ failed: true, kind: 'refused', status: 200, detail: null });
  });

  it('does not mistake a sync outcome for a failure', async () => {
    // The loop that calls this returns { kind: 'offline' } of its own. Sharing a
    // field name is not sharing a meaning.
    expect(isFailure({ kind: 'offline' })).toBe(false);
    expect(isFailure({ failed: true, kind: 'offline', status: null, detail: null })).toBe(true);
  });

  it('refuses a 200 that is not the reply sync promised', async () => {
    vi.stubGlobal('fetch', reply(200, { something: 'else' }));
    const result = await sync('t', null, { projects: [], plans: [], overrides: [] });
    expect(result).toEqual({ failed: true, kind: 'refused', status: 200, detail: null });
  });

  it('keeps the real status when the door is shut', async () => {
    // login.ts answers 429 with { error: 'too many attempts' } after five wrong
    // guesses. Reporting that as anything else would tell the login screen the
    // server is broken when the password may well be right.
    vi.stubGlobal('fetch', reply(429, { error: 'too many attempts' }));
    expect(await login('gabriel', 'whatever')).toEqual({
      failed: true,
      kind: 'refused',
      status: 429,
      detail: { error: 'too many attempts' },
    });
  });

  it('keeps the body of a refusal, so a screen can say which refusal it was', async () => {
    vi.stubGlobal('fetch', reply(400, { error: 'password too short', minimum: 12 }));

    expect(await login('ana@example.com', 'short')).toEqual({
      failed: true,
      kind: 'refused',
      status: 400,
      detail: { error: 'password too short', minimum: 12 },
    });
  });

  it('has no detail when a refusal carries no JSON object', async () => {
    // nginx answers a dead upstream with an HTML page, which is not JSON.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 502,
        ok: false,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      }),
    );
    expect(await login('ana@example.com', 'whatever')).toEqual({ failed: true, kind: 'refused', status: 502, detail: null });

    // A list is JSON but names no refusal.
    vi.stubGlobal('fetch', reply(400, ['password too short']));
    expect(await login('ana@example.com', 'whatever')).toEqual({ failed: true, kind: 'refused', status: 400, detail: null });
  });

  it('does not turn a 500 from sync into an answer', async () => {
    vi.stubGlobal('fetch', reply(500, { error: 'boom' }));
    const result = await sync('t', null, { projects: [], plans: [], overrides: [] });
    expect(result).toEqual({ failed: true, kind: 'refused', status: 500, detail: { error: 'boom' } });
  });

  it('gives up on a round that never answers, instead of waiting for ever', async () => {
    const fetcher = reply(200, { token: 'abc' });
    vi.stubGlobal('fetch', fetcher);

    await login('gabriel', 'a-long-password');

    // The sync loop fires rounds from a timer without waiting for them. Without
    // a deadline, one hung request stays hung and the next round piles on top.
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('gives up after fifteen seconds, not at some other time', async () => {
    const fetcher = reply(200, { token: 'abc' });
    vi.stubGlobal('fetch', fetcher);
    const timeouts: number[] = [];
    const realTimeout = AbortSignal.timeout;
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      timeouts.push(ms);
      return realTimeout.call(AbortSignal, ms);
    });

    await login('gabriel', 'a-long-password');

    // A number, not "some signal": a deadline of one millisecond and a deadline
    // that never fires both satisfy "there is a signal".
    expect(timeouts).toEqual([15_000]);
  });

  it('reports a round it abandoned as offline, like any other silence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError')),
    );

    expect(await login('gabriel', 'a-long-password')).toEqual({
      failed: true,
      kind: 'offline',
      status: null,
      detail: null,
    });
  });

  it('posts sync to its own origin too, with the cursor and the changes', async () => {
    const fetcher = reply(200, { serverTime: 'T', changes: { projects: [], plans: [], overrides: [] }, rejected: [] });
    vi.stubGlobal('fetch', fetcher);

    await sync('t', 'T0', { projects: [], plans: [{ id: 'p1', updatedAt: 'U' }], overrides: [] });

    // Task 6 injects this call, so its tests never see a URL. If the path or the
    // body were wrong, only production would find out.
    expect(fetcher.mock.calls[0][0]).toBe('/api/sync');
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      since: 'T0',
      changes: { projects: [], plans: [{ id: 'p1', updatedAt: 'U' }], overrides: [] },
    });
  });

  it('asks the server to forget a token, and takes no content for an answer', async () => {
    // A real fetch rejects `json()` on an empty 204 body. Without that, this
    // test could not tell a client that handles 204 from one that parses it.
    const fetcher = vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    });
    vi.stubGlobal('fetch', fetcher);

    expect(await logout('the-token')).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/logout');
    const init = fetcher.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer the-token');
  });

  it('reads the account a sync reply names', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, { serverTime: 'T', changes: { projects: [], plans: [], overrides: [] }, rejected: [], userId: 'u1' }),
    );

    const result = await sync('t', null, { projects: [], plans: [], overrides: [] });

    expect(isFailure(result)).toBe(false);
    expect((result as { userId?: unknown }).userId).toBe('u1');
  });

  it('reads a sync reply that names no account, as a server from before accounts sends it', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, { serverTime: 'T', changes: { projects: [], plans: [], overrides: [] }, rejected: [] }),
    );

    const result = await sync('t', null, { projects: [], plans: [], overrides: [] });

    // Optional on purpose: a client that required it would refuse every round
    // from a server one deploy behind, and the device would stop syncing.
    expect(isFailure(result)).toBe(false);
  });

  it('refuses a sync reply whose account is not a string', async () => {
    vi.stubGlobal(
      'fetch',
      reply(200, { serverTime: 'T', changes: { projects: [], plans: [], overrides: [] }, rejected: [], userId: 42 }),
    );

    const result = await sync('t', null, { projects: [], plans: [], overrides: [] });

    // The engine compares this field with the account it holds. A number that
    // slipped through would compare unequal to every account there is.
    expect(result).toEqual({ failed: true, kind: 'refused', status: 200, detail: null });
  });

  const sentBody = (fetcher: ReturnType<typeof reply>) =>
    JSON.parse((fetcher.mock.calls[0][1] as RequestInit).body as string) as unknown;

  it('signs in by email, not by username', async () => {
    const fetcher = reply(200, { token: 'abc', userId: 'u1' });
    vi.stubGlobal('fetch', fetcher);

    await login('ana@example.com', 'a-long-password');

    // The server reads `email` since the accounts phase; a body with
    // `username` is answered 401 however right the password is.
    expect(sentBody(fetcher)).toEqual({ email: 'ana@example.com', password: 'a-long-password' });
  });

  it('creates an account and hands back its session, and whether the confirmation left', async () => {
    const fetcher = reply(201, { token: 'abc', userId: 'u1', confirmationSent: true });
    vi.stubGlobal('fetch', fetcher);

    expect(await register('ana@example.com', 'a-long-password')).toEqual({
      token: 'abc',
      userId: 'u1',
      confirmationSent: true,
    });
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/register');
    expect(sentBody(fetcher)).toEqual({ email: 'ana@example.com', password: 'a-long-password' });

    // The server says so when the email could not leave; the account exists anyway.
    vi.stubGlobal('fetch', reply(201, { token: 'abc', userId: 'u1', confirmationSent: false }));
    expect(await register('ana@example.com', 'a-long-password')).toMatchObject({ confirmationSent: false });
  });

  it('refuses a new account that comes without its id, as login does', async () => {
    vi.stubGlobal('fetch', reply(201, { token: 'abc', confirmationSent: true }));
    expect(await register('ana@example.com', 'a-long-password')).toEqual({
      failed: true,
      kind: 'refused',
      status: 201,
      detail: null,
    });
  });

  it('passes a refused registration through, with its reason', async () => {
    vi.stubGlobal('fetch', reply(409, { error: 'email taken' }));
    expect(await register('ana@example.com', 'a-long-password')).toEqual({
      failed: true,
      kind: 'refused',
      status: 409,
      detail: { error: 'email taken' },
    });
  });

  it('asks for a reset link with the address alone, and takes an empty answer as done', async () => {
    const fetcher = reply(200, {});
    vi.stubGlobal('fetch', fetcher);

    expect(await requestReset('ana@example.com')).toBe(true);
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/request-reset');
    expect(sentBody(fetcher)).toEqual({ email: 'ana@example.com' });

    vi.stubGlobal('fetch', reply(429, { error: 'too many attempts' }));
    expect(await requestReset('ana@example.com')).toEqual({
      failed: true,
      kind: 'refused',
      status: 429,
      detail: { error: 'too many attempts' },
    });
  });

  it('sets a new password with the token from the link, and hands back a new session', async () => {
    const fetcher = reply(200, { token: 'fresh', userId: 'u1' });
    vi.stubGlobal('fetch', fetcher);

    expect(await resetPassword('f'.repeat(64), 'a-new-long-password')).toEqual({ token: 'fresh', userId: 'u1' });
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/reset');
    expect(sentBody(fetcher)).toEqual({ token: 'f'.repeat(64), password: 'a-new-long-password' });

    vi.stubGlobal('fetch', reply(200, { token: 'fresh' }));
    expect(await resetPassword('f'.repeat(64), 'a-new-long-password')).toEqual({
      failed: true,
      kind: 'refused',
      status: 200,
      detail: null,
    });
  });

  it('confirms a link, and says which kind it was', async () => {
    const fetcher = reply(200, { confirmed: 'email' });
    vi.stubGlobal('fetch', fetcher);
    expect(await confirmLink('c'.repeat(64))).toEqual({ confirmed: 'email' });
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/confirm');
    expect(sentBody(fetcher)).toEqual({ token: 'c'.repeat(64) });

    vi.stubGlobal('fetch', reply(200, { confirmed: 'new-email', email: 'new@example.com' }));
    expect(await confirmLink('c'.repeat(64))).toEqual({ confirmed: 'new-email', email: 'new@example.com' });
  });

  it('refuses a confirmation it does not recognise', async () => {
    // A new address without the address is not an answer the screen can show.
    vi.stubGlobal('fetch', reply(200, { confirmed: 'new-email' }));
    expect(await confirmLink('c'.repeat(64))).toEqual({ failed: true, kind: 'refused', status: 200, detail: null });

    vi.stubGlobal('fetch', reply(200, { confirmed: 'something' }));
    expect(await confirmLink('c'.repeat(64))).toEqual({ failed: true, kind: 'refused', status: 200, detail: null });
  });
});
