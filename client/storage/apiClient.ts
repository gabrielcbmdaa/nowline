/**
 * The only file in the app that knows a network exists. Everything above it
 * receives either an answer or an `ApiFailure`, never an exception: a phone in
 * a lift is the normal case here, not an error worth unwinding the stack for.
 */

export type SyncRow = { id: string; updatedAt: string; [field: string]: unknown };
export type SyncChanges = { projects: SyncRow[]; plans: SyncRow[]; overrides: SyncRow[] };
/** `userId` is optional so an older server's reply still reads; when present it must be a string. */
export type SyncReply = { serverTime: string; changes: SyncChanges; rejected: string[]; userId?: string };

/** A token and the account it belongs to, which a device only ever stores together. */
export type Session = { token: string; userId: string };

/**
 * `offline` means nobody answered and the same request is worth repeating.
 * `unauthorized` means the token is no good and repeating it is pointless
 * until somebody logs in again. `refused` is everything else.
 */
export type ApiFailure = {
  /** A marker, not decoration: `kind` alone is a field other result types have too. */
  failed: true;
  kind: 'offline' | 'unauthorized' | 'refused';
  status: number | null;
};

export function isFailure(result: unknown): result is ApiFailure {
  return typeof result === 'object' && result !== null && (result as { failed?: unknown }).failed === true;
}

/** Fifteen seconds. A round that has not answered by then is not going to. */
const GIVE_UP_AFTER_MS = 15_000;

function isSyncReply(value: unknown): value is SyncReply {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as { serverTime?: unknown; changes?: unknown; rejected?: unknown; userId?: unknown };
  if (typeof row.serverTime !== 'string' || !Array.isArray(row.rejected)) return false;
  if (row.userId !== undefined && typeof row.userId !== 'string') return false;
  const changes = row.changes as { projects?: unknown; plans?: unknown; overrides?: unknown } | null;
  if (typeof changes !== 'object' || changes === null) return false;
  return (
    Array.isArray(changes.projects) && Array.isArray(changes.plans) && Array.isArray(changes.overrides)
  );
}

async function post(path: string, body: unknown, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GIVE_UP_AFTER_MS),
    });
  } catch {
    // fetch only rejects when the request never got an answer at all.
    return { failed: true, kind: 'offline', status: null };
  }

  if (response.status === 401) return { failed: true, kind: 'unauthorized', status: 401 };
  if (!response.ok) return { failed: true, kind: 'refused', status: response.status };

  // No content is an answer too: logout has nothing to say except that it
  // happened, and parsing an empty body would call that a refusal.
  if (response.status === 204) return null;

  try {
    return await response.json();
  } catch {
    // A 200 whose body is not JSON is not the server we think it is.
    return { failed: true, kind: 'refused', status: response.status };
  }
}

export async function login(username: string, password: string): Promise<Session | ApiFailure> {
  const result = await post('/api/auth/login', { username, password });
  if (isFailure(result)) return result;

  const { token, userId } = result as { token?: unknown; userId?: unknown };
  // Both halves or neither: a token without its account is one the device
  // cannot tell apart from somebody else's.
  return typeof token === 'string' && typeof userId === 'string'
    ? { token, userId }
    : { failed: true, kind: 'refused', status: 200 };
}

/** Ask the server to forget a session. It answers the same whether it knew the token or not. */
export async function logout(token: string): Promise<true | ApiFailure> {
  const result = await post('/api/auth/logout', {}, token);
  return isFailure(result) ? result : true;
}

export async function sync(
  token: string,
  since: string | null,
  changes: SyncChanges,
): Promise<SyncReply | ApiFailure> {
  const result = await post('/api/sync', { since, changes }, token);
  if (isFailure(result)) return result;
  // A cast is a promise; this is a check. The loop reads reply.changes, and a
  // 200 that is not this shape would throw there — which the comment at the top
  // of this file says must never happen.
  return isSyncReply(result) ? result : { failed: true, kind: 'refused', status: 200 };
}
