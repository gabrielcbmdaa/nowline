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
  /**
   * The body of a refusal when it is a JSON object — `{ error, minimum }` and the
   * like — so a screen can say which refusal it was. `null` when there is none.
   */
  detail: Record<string, unknown> | null;
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

async function detailOf(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await response.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    // An HTML error page from nginx, or no body at all.
    return null;
  }
}

async function request(method: 'GET' | 'POST', path: string, body: unknown, token?: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(GIVE_UP_AFTER_MS),
    });
  } catch {
    // fetch only rejects when the request never got an answer at all.
    return { failed: true, kind: 'offline', status: null, detail: null };
  }

  if (response.status === 401) {
    return { failed: true, kind: 'unauthorized', status: 401, detail: await detailOf(response) };
  }
  if (!response.ok) {
    return { failed: true, kind: 'refused', status: response.status, detail: await detailOf(response) };
  }

  // No content is an answer too: logout has nothing to say except that it
  // happened, and parsing an empty body would call that a refusal.
  if (response.status === 204) return null;

  try {
    return await response.json();
  } catch {
    // A 200 whose body is not JSON is not the server we think it is.
    return { failed: true, kind: 'refused', status: response.status, detail: null };
  }
}

function post(path: string, body: unknown, token?: string): Promise<unknown> {
  return request('POST', path, body, token);
}

/** A token and its account from a reply body, or `null` unless both are strings. */
function sessionIn(body: unknown): Session | null {
  if (typeof body !== 'object' || body === null) return null;
  const { token, userId } = body as { token?: unknown; userId?: unknown };
  return typeof token === 'string' && typeof userId === 'string' ? { token, userId } : null;
}

export async function login(email: string, password: string): Promise<Session | ApiFailure> {
  const result = await post('/api/auth/login', { email, password });
  if (isFailure(result)) return result;

  // Both halves or neither: a token without its account is one the device
  // cannot tell apart from somebody else's.
  return sessionIn(result) ?? { failed: true, kind: 'refused', status: 200, detail: null };
}

/** Ask the server to forget a session. It answers the same whether it knew the token or not. */
export async function logout(token: string): Promise<true | ApiFailure> {
  const result = await post('/api/auth/logout', {}, token);
  return isFailure(result) ? result : true;
}

/** What the server knows about the account a token belongs to. */
export type Account = { userId: string; email: string | null; verifiedAt: string | null };

function accountIn(body: unknown): Account | null {
  if (typeof body !== 'object' || body === null) return null;
  const { userId, email, verifiedAt } = body as { userId?: unknown; email?: unknown; verifiedAt?: unknown };
  if (typeof userId !== 'string') return null;
  if (email !== null && typeof email !== 'string') return null;
  if (verifiedAt !== null && typeof verifiedAt !== 'string') return null;
  return { userId, email, verifiedAt };
}

/** The first GET: who this token belongs to. A 401 is a session that is over. */
export async function me(token: string): Promise<Account | ApiFailure> {
  const result = await request('GET', '/api/auth/me', undefined, token);
  if (isFailure(result)) return result;
  return accountIn(result) ?? { failed: true, kind: 'refused', status: 200, detail: null };
}

/** Whether the email left. `false` means the provider refused; the account is unchanged. */
export type Sent = { sent: boolean };

function sentIn(body: unknown): Sent | null {
  if (typeof body !== 'object' || body === null) return null;
  const { sent } = body as { sent?: unknown };
  return typeof sent === 'boolean' ? { sent } : null;
}

export async function sendConfirmation(token: string): Promise<Sent | ApiFailure> {
  const result = await post('/api/auth/send-confirmation', {}, token);
  if (isFailure(result)) return result;
  return sentIn(result) ?? { failed: true, kind: 'refused', status: 200, detail: null };
}

/** The current password is asked for here, and a wrong one is a 403: it must not end the session. */
export async function changeEmail(token: string, email: string, password: string): Promise<Sent | ApiFailure> {
  const result = await post('/api/auth/change-email', { email, password }, token);
  if (isFailure(result)) return result;
  return sentIn(result) ?? { failed: true, kind: 'refused', status: 200, detail: null };
}

/** A new account comes signed in, and says whether its confirmation email left. */
export type Registered = Session & { confirmationSent: boolean };

export async function register(email: string, password: string): Promise<Registered | ApiFailure> {
  const result = await post('/api/auth/register', { email, password });
  if (isFailure(result)) return result;

  const session = sessionIn(result);
  if (session === null) return { failed: true, kind: 'refused', status: 201, detail: null };
  const { confirmationSent } = result as { confirmationSent?: unknown };
  return { ...session, confirmationSent: confirmationSent === true };
}

/** The server answers the same for every address, so there is nothing to read but success. */
export async function requestReset(email: string): Promise<true | ApiFailure> {
  const result = await post('/api/auth/request-reset', { email });
  return isFailure(result) ? result : true;
}

/** Spends the link. The session it returns is the only one the account has left. */
export async function resetPassword(token: string, password: string): Promise<Session | ApiFailure> {
  const result = await post('/api/auth/reset', { token, password });
  if (isFailure(result)) return result;
  return sessionIn(result) ?? { failed: true, kind: 'refused', status: 200, detail: null };
}

export type Confirmed = { confirmed: 'email' } | { confirmed: 'new-email'; email: string };

/** Spends the link. Called from a button, never when a page loads. */
export async function confirmLink(token: string): Promise<Confirmed | ApiFailure> {
  const result = await post('/api/auth/confirm', { token });
  if (isFailure(result)) return result;

  const { confirmed, email } = (result ?? {}) as { confirmed?: unknown; email?: unknown };
  if (confirmed === 'email') return { confirmed };
  if (confirmed === 'new-email' && typeof email === 'string') return { confirmed, email };
  return { failed: true, kind: 'refused', status: 200, detail: null };
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
  return isSyncReply(result) ? result : { failed: true, kind: 'refused', status: 200, detail: null };
}
