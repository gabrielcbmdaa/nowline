import type { Express } from 'express';
import type { AddressInfo } from 'node:net';

export type Reply = { status: number; contentType: string; body: unknown };

/**
 * Binds port 0 so the operating system picks a free one: a fixed port makes
 * two test files racing each other fail in a way that reads like a bug in
 * the code. The body is read before the server closes, so nothing is left
 * half-streamed.
 */
export async function call(
  app: Express,
  path: string,
  init?: { method?: string; body?: unknown; token?: string },
): Promise<Reply> {
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    // `connection: close` on purpose: this helper opens a server per call and closes it
    // again, and node's fetch pools sockets by default. A pooled socket outliving its
    // server can deliver a later request to whatever grabbed that port next. A full
    // suite once failed here with a 403 that nothing in this repository returns.
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      connection: 'close',
    };
    if (init?.token) headers.authorization = `Bearer ${init.token}`;

    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: init?.method ?? 'GET',
      headers,
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await response.text();
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: text ? JSON.parse(text) : null,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
