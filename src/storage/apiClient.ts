/**
 * The only file in the app that knows a network exists. Everything above it
 * receives either an answer or an `ApiFailure`, never an exception: a phone in
 * a lift is the normal case here, not an error worth unwinding the stack for.
 */

export type SyncRow = { id: string; updatedAt: string; [field: string]: unknown };
export type SyncChanges = { projects: SyncRow[]; plans: SyncRow[]; overrides: SyncRow[] };
export type SyncReply = { serverTime: string; changes: SyncChanges; rejected: string[] };

/**
 * `offline` means nobody answered and the same request is worth repeating.
 * `unauthorized` means the token is no good and repeating it is pointless
 * until somebody logs in again. `refused` is everything else.
 */
export type ApiFailure = { kind: 'offline' | 'unauthorized' | 'refused'; status: number | null };

export function isFailure(result: unknown): result is ApiFailure {
  return typeof result === 'object' && result !== null && 'kind' in result;
}

async function post(path: string, body: unknown, token?: string): Promise<unknown | ApiFailure> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    // fetch only rejects when the request never got an answer at all.
    return { kind: 'offline', status: null };
  }

  if (response.status === 401) return { kind: 'unauthorized', status: 401 };
  if (!response.ok) return { kind: 'refused', status: response.status };

  try {
    return await response.json();
  } catch {
    // A 200 whose body is not JSON is not the server we think it is.
    return { kind: 'refused', status: response.status };
  }
}

export async function login(
  username: string,
  password: string,
): Promise<{ token: string } | ApiFailure> {
  const result = await post('/api/auth/login', { username, password });
  if (isFailure(result)) return result;

  const token = (result as { token?: unknown }).token;
  return typeof token === 'string' ? { token } : { kind: 'refused', status: 200 };
}

export async function sync(
  token: string,
  since: string | null,
  changes: SyncChanges,
): Promise<SyncReply | ApiFailure> {
  const result = await post('/api/sync', { since, changes }, token);
  if (isFailure(result)) return result;
  return result as SyncReply;
}
