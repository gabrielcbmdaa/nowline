// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFailure, login, sync } from './apiClient';

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

  it('hands back the token the server issued', async () => {
    vi.stubGlobal('fetch', reply(200, { token: 'abc' }));
    expect(await login('gabriel', 'a-long-password')).toEqual({ token: 'abc' });
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
    expect(await login('gabriel', 'wrong')).toEqual({ failed: true, kind: 'unauthorized', status: 401 });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await login('gabriel', 'whatever')).toEqual({ failed: true, kind: 'offline', status: null });
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
    expect(await login('gabriel', 'a-long-password')).toEqual({ failed: true, kind: 'refused', status: 200 });
  });

  it('does not mistake a sync outcome for a failure', async () => {
    // The loop that calls this returns { kind: 'offline' } of its own. Sharing a
    // field name is not sharing a meaning.
    expect(isFailure({ kind: 'offline' })).toBe(false);
    expect(isFailure({ failed: true, kind: 'offline', status: null })).toBe(true);
  });

  it('refuses a 200 that is not the reply sync promised', async () => {
    vi.stubGlobal('fetch', reply(200, { something: 'else' }));
    const result = await sync('t', null, { projects: [], plans: [], overrides: [] });
    expect(result).toEqual({ failed: true, kind: 'refused', status: 200 });
  });

  it('keeps the real status when the door is shut', async () => {
    // login.ts answers 429 with { error: 'too many attempts' } after five wrong
    // guesses. Reporting that as anything else would tell the login screen the
    // server is broken when the password may well be right.
    vi.stubGlobal('fetch', reply(429, { error: 'too many attempts' }));
    expect(await login('gabriel', 'whatever')).toEqual({ failed: true, kind: 'refused', status: 429 });
  });

  it('does not turn a 500 from sync into an answer', async () => {
    vi.stubGlobal('fetch', reply(500, { error: 'boom' }));
    const result = await sync('t', null, { projects: [], plans: [], overrides: [] });
    expect(result).toEqual({ failed: true, kind: 'refused', status: 500 });
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
});
