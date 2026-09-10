import * as apiClient from './apiClient';
import { isFailure } from './apiClient';
import type { SentRows } from './localStorageRepository';
import { repository as liveRepository } from './repository';
import type { BlockRepository } from './repository';
import { reportWarning } from '../reportError';

/**
 * Nothing in this module runs while something else in it is running.
 *
 * There are three ways in — a round, a look, and a settle — and they all read
 * and write the same two things: this device's queue and its cursor. Two of
 * them overlapping is how a cursor written by one gets replaced by an older
 * one from the other, and how a first sync that failed still leaves both sides
 * mixed. One lock on one of the three doors, which is what this had, only
 * closes that door.
 *
 * Each public function wraps its own body. The bodies call each other directly
 * — a settle runs a round inside itself, and if the inner call waited for the
 * lock the outer one holds, it would wait for ever.
 *
 * A body that never settles holds the door forever. In production the only body
 * that waits is `apiClient.sync`, bounded by `GIVE_UP_AFTER_MS` in
 * `apiClient.ts`; deleting that deadline does not make this queue recover.
 */
let queue: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  // Two lines keep the door open after a failure, and either one alone is
  // enough — which is why removing one of them breaks nothing and looks safe.
  // `then(work, work)` runs the next operation even when the previous promise
  // rejected; `mine.catch` hands the queue a fulfilled promise so the one after
  // that has something to wait on. Take both away and the first failed round
  // shuts the engine for good, with nothing on screen to say why.
  const mine = queue.then(work, work);
  queue = mine.catch(() => undefined);
  return mine;
}

export type SyncOutcome =
  | { kind: 'done'; downloaded: number; stillOwed: number }
  | { kind: 'offline' }
  | { kind: 'unauthorized' }
  | { kind: 'needs-first-sync' }
  | { kind: 'refused'; status: number | null }
  | { kind: 'undecided' };

export type FirstSyncDecision = 'upload-mine' | 'take-the-cloud' | 'ask-the-owner';

export type FirstSyncLook =
  | { kind: 'ask'; local: number; remote: number }
  | { kind: 'settled'; choice: FirstSyncDecision }
  | { kind: 'already-joined' }
  | { kind: 'offline' }
  | { kind: 'unauthorized' }
  | { kind: 'refused'; status: number | null };

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
export function syncOnce(
  deps: { send?: typeof apiClient.sync; repo?: BlockRepository } = {},
): Promise<SyncOutcome> {
  return oneAtATime(() => runSyncOnce(deps));
}

async function runSyncOnce(
  deps: { send?: typeof apiClient.sync; repo?: BlockRepository } = {},
  /**
   * Only the first-sync settle passes this. It is the caller saying "the owner
   * chose, I am carrying that out" — which is a different fact from "this
   * device has joined", and the flag on disk must not be used to fake it.
   */
  answeredByTheOwner = false,
): Promise<SyncOutcome> {
  const send = deps.send ?? apiClient.sync;
  const repo = deps.repo ?? liveRepository;

  const { token, cursor, joined } = await repo.readSyncState();
  if (token === null) return { kind: 'unauthorized' };

  // The engine never answers the first-sync question on its own. Section 9 of
  // the design: ids are made per device, so merging two sides without asking
  // does not lose data, it doubles it — and a round fired by a timer is not a
  // decision anybody made.
  if (!joined && !answeredByTheOwner) return { kind: 'needs-first-sync' };

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

/**
 * What a device that has never synced finds, without changing anything.
 *
 * Uploads nothing and writes nothing down: the answer to "both sides have
 * rows" is a screen, and a screen that has not been shown yet cannot be
 * overruled by a round that a timer started.
 */
export function inspectFirstSync(
  deps: { send?: typeof apiClient.sync; repo?: BlockRepository } = {},
): Promise<FirstSyncLook> {
  return oneAtATime(() => runInspectFirstSync(deps));
}

async function runInspectFirstSync(
  deps: { send?: typeof apiClient.sync; repo?: BlockRepository } = {},
): Promise<FirstSyncLook> {
  const send = deps.send ?? apiClient.sync;
  const repo = deps.repo ?? liveRepository;

  const { token, joined } = await repo.readSyncState();
  if (token === null) return { kind: 'unauthorized' };
  // Asked and answered. A screen that keeps offering the first-sync buttons is
  // offering "throw away everything written since" for ever.
  if (joined) return { kind: 'already-joined' };

  const nothing = { projects: [], plans: [], overrides: [] };
  const reply = await send(token, null, nothing);
  if (isFailure(reply)) {
    if (reply.kind === 'offline') return { kind: 'offline' };
    if (reply.kind === 'unauthorized') return { kind: 'unauthorized' };
    return { kind: 'refused', status: reply.status };
  }

  const remote =
    reply.changes.projects.length + reply.changes.plans.length + reply.changes.overrides.length;
  const local = await repo.countLocalRows();

  const choice = firstSyncDecision(local, remote);
  return choice === 'ask-the-owner' ? { kind: 'ask', local, remote } : { kind: 'settled', choice };
}

export function settleFirstSync(
  choice: FirstSyncDecision,
  deps: { send?: typeof apiClient.sync; repo?: BlockRepository; today?: () => string } = {},
): Promise<SyncOutcome> {
  return oneAtATime(() => runSettleFirstSync(choice, deps));
}

async function runSettleFirstSync(
  choice: FirstSyncDecision,
  deps: { send?: typeof apiClient.sync; repo?: BlockRepository; today?: () => string } = {},
): Promise<SyncOutcome> {
  const send = deps.send ?? apiClient.sync;
  const repo = deps.repo ?? liveRepository;
  const today = deps.today ?? (() => new Date().toISOString().slice(0, 10));

  // Not a choice that can be carried out: it is the absence of one. Letting it
  // fall through to the upload path is the blind merge this whole pair of
  // functions exists to prevent, reached by passing the wrong argument.
  if (choice === 'ask-the-owner') return { kind: 'undecided' };

  const state = await repo.readSyncState();
  if (state.token === null) return { kind: 'unauthorized' };

  if (choice === 'take-the-cloud') {
    const reply = await send(state.token, null, { projects: [], plans: [], overrides: [] });
    if (isFailure(reply)) {
      return reply.kind === 'offline'
        ? { kind: 'offline' }
        : reply.kind === 'unauthorized'
          ? { kind: 'unauthorized' }
          : { kind: 'refused', status: reply.status };
    }
    const arriving =
      reply.changes.projects.length + reply.changes.plans.length + reply.changes.overrides.length;
    if (arriving === 0) return { kind: 'undecided' };
    // The copy first, always, and only then the replacement.
    await repo.keepDiscardedCopy(today());
    await repo.replaceAllFromServer(reply.changes);
    const downloaded =
      reply.changes.projects.length + reply.changes.plans.length + reply.changes.overrides.length;
    await repo.writeSyncState({ token: state.token, cursor: reply.serverTime, joined: true });
    return { kind: 'done', downloaded, stillOwed: 0 };
  }

  await repo.queueEverything();
  const outcome = await runSyncOnce({ send, repo }, true);
  // That round wrote the state back with the `joined` it read when it started,
  // which is still false. The line below is what makes it true, and between the
  // two the disk is wrong in the safe direction: another tab reading it refuses
  // to sync. Written down in this phase's lessons rather than fixed, because
  // fixing it means every writer touching only its own field, and that is a
  // change to the repository, not to this line.
  // The flag goes up only now, and only if the round really went through.
  // There is nothing to revert on the other paths, because nothing was claimed.
  if (outcome.kind === 'done') {
    const after = await repo.readSyncState();
    await repo.writeSyncState({ ...after, joined: true });
  }
  return outcome;
}
