import * as apiClient from './apiClient';
import { isFailure } from './apiClient';
import type { SentRows } from './localStorageRepository';
import { repository as liveRepository } from './repository';
import type { BlockRepository } from './repository';
import { reportWarning } from '../reportError';

export type SyncOutcome =
  | { kind: 'done'; downloaded: number; stillOwed: number }
  | { kind: 'offline' }
  | { kind: 'unauthorized' }
  | { kind: 'needs-first-sync' }
  | { kind: 'refused'; status: number | null };

export type FirstSyncDecision = 'upload-mine' | 'take-the-cloud' | 'ask-the-owner';

/**
 * What a device that has never synced should do, by what it finds on each
 * side. Ids are generated per device, so a block called "Gym" made on the
 * phone and another made on the laptop are two different rows: merging the
 * two sides without asking does not lose anything, it silently doubles it.
 *
 * Pure arithmetic on two counts, so the screen in the next plan has nothing
 * to decide — it only shows the numbers and reports the answer.
 */
export function firstSyncDecision(local: number, remote: number): FirstSyncDecision {
  if (local > 0 && remote > 0) return 'ask-the-owner';
  if (remote > 0) return 'take-the-cloud';
  return 'upload-mine';
}

/**
 * One round trip: everything this device owes goes up, everything it is
 * missing comes down. Injectable on purpose — the app calls it with no
 * arguments, and the tests hand it a server that never touches the network.
 */
export async function syncOnce(
  deps: { send?: typeof apiClient.sync; repo?: BlockRepository } = {},
): Promise<SyncOutcome> {
  const send = deps.send ?? apiClient.sync;
  const repo = deps.repo ?? liveRepository;

  const { token, cursor, joined } = await repo.readSyncState();
  if (token === null) return { kind: 'unauthorized' };

  // The engine never answers the first-sync question on its own. Section 9 of
  // the design: ids are made per device, so merging two sides without asking
  // does not lose data, it doubles it — and a round fired by a timer is not a
  // decision anybody made.
  if (!joined) return { kind: 'needs-first-sync' };

  const pending = await repo.listPending();
  const outgoing = await repo.rowsToUpload(pending);

  // Read the stamps BEFORE the request goes out. What comes back is confirmed
  // against these, not against whatever the rows say when the answer lands.
  const sent: SentRows = {
    projects: outgoing.projects.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
    plans: outgoing.plans.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
    overrides: outgoing.overrides.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
  };

  const reply = await send(token, cursor, outgoing);

  if (isFailure(reply)) {
    if (reply.kind === 'unauthorized') {
      // Drop the dead token, keep the cursor: the rows already downloaded are
      // still downloaded, and a password prompt should not cost a full resync.
      await repo.writeSyncState({ token: null, cursor, joined });
      return { kind: 'unauthorized' };
    }
    if (reply.kind === 'offline') return { kind: 'offline' };
    reportWarning('The server refused a sync round', reply);
    return { kind: 'refused', status: reply.status };
  }

  await repo.applyFromServer(reply.changes);

  // Anything the server named as refused stays owed, however it was sent.
  const refused = new Set(reply.rejected);
  const keep = (rows: readonly { id: string; updatedAt: string }[]) =>
    rows.filter((row) => !refused.has(row.id));

  await repo.clearPendingUnchanged({
    projects: keep(sent.projects),
    plans: keep(sent.plans),
    overrides: keep(sent.overrides),
  });

  await repo.writeSyncState({ token, cursor: reply.serverTime, joined });

  const downloaded =
    reply.changes.projects.length + reply.changes.plans.length + reply.changes.overrides.length;
  const left = await repo.listPending();
  const stillOwed = left.projects.length + left.plans.length + left.overrides.length;

  return { kind: 'done', downloaded, stillOwed };
}
