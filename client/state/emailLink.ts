/** A link from one of the server's emails: what it is for, and its secret. */
export type EmailLink = { kind: 'confirm' | 'reset'; token: string };

const FRAGMENT = /^#(confirm|reset)=(.*)$/;
/** What `server/links.ts` issues: 32 random bytes, in lowercase hex. */
const TOKEN = /^[0-9a-f]{64}$/;

/**
 * Reads a link from the URL fragment and takes it out of the address bar.
 *
 * The fragment, because the browser never sends it: a path or a query string
 * would be written in plain text in nginx's access log. Removed as soon as it is
 * read, malformed or not, so the secret stays out of the history and out of any
 * bookmark. Nothing is spent here — reading a link is not following it.
 */
export function takeEmailLink(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState'>,
): EmailLink | null {
  const match = FRAGMENT.exec(location.hash);
  if (match === null) return null;

  history.replaceState(null, '', location.pathname + location.search);

  const [, kind, token] = match;
  if (!TOKEN.test(token)) return null;
  return { kind: kind === 'confirm' ? 'confirm' : 'reset', token };
}
