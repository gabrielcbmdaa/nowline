// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFailure, login, sync } from './apiClient';

const reply = (status: number, body: unknown) =>
  vi.fn().mockResolvedValue({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as unknown as Response);

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
    expect(await login('gabriel', 'wrong')).toEqual({ kind: 'unauthorized', status: 401 });

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    expect(await login('gabriel', 'whatever')).toEqual({ kind: 'offline', status: null });
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
      } as unknown as Response),
    );

    // The error page the dev server serves for a malformed body is HTML. A
    // caller that trusted this would carry `undefined` into storage.
    expect(await login('gabriel', 'a-long-password')).toEqual({ kind: 'refused', status: 200 });
  });
});
