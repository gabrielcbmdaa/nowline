import * as apiClient from './apiClient';
import { isFailure, type Session } from './apiClient';
import type { SentRows } from './localStorageRepository';
import { repository as liveRepository } from './repository';
import type { BlockRepository } from './repository';
import { reportError, reportWarning } from '../reportError';

/**
 * Nothing in this module runs while something else in it is running.
 *
 * There are four ways in — a round, a look, a settle, and adopting a session —
 * and they all read and write the same things: this device's queue, its cursor,
 * and whose rows it holds. Two of them overlapping is how a cursor written by
 * one gets replaced by an older one from the other, how a first sync that
 * failed still leaves both sides mixed, and how a change of owner counts a
 * queue a round is busy emptying. One lock on one of the doors, which is what
 * this had, only closes that door.
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

/** What the person holding the device answered, when they were asked. */
export type AdoptAnswer = 'discard' | 'keep';

/**
 * `other-account`: the rows belong to an account that is not this session's,
 * and `atRisk` of them have not reached that account's cloud. `unknown-owner`:
 * a device from before accounts, whose `rows` no account has claimed.
 */
export type AdoptQuestion =
  | { kind: 'other-account'; atRisk: number }
  | { kind: 'unknown-owner'; rows: number };

export type AdoptOutcome = { kind: 'adopted' } | AdoptQuestion;

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

  const state = await repo.readSyncState();
  const { token, cursor, joined } = state;
  if (token === null) return { kind: 'unauthorized' };

  // The engine never answers the first-sync question on its own. Section 9 of
  // the design: ids are made per device, so merging two sides without asking
  // does not lose data, it doubles it — and a round fired by a timer is not a
  // decision anybody made.
  if (!joined && !answeredByTheOwner) return { kind: 'needs-first-sync' };

  // A full download is owed once damaged rows have been overwritten locally: the
  // cursor has passed them, so only `null` brings back what the server holds.
  const owed = await repo.readResyncOwed();

  const pending = await repo.listPending();
  const outgoing = await repo.rowsToUpload(pending);

  // Read the stamps BEFORE the request goes out. What comes back is confirmed
  // against these, not against whatever the rows say when the answer lands.
  const sent: SentRows = {
    projects: outgoing.projects.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
    plans: outgoing.plans.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
    overrides: outgoing.overrides.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
  };

  const reply = await send(token, owed === null ? cursor : null, outgoing);

  if (isFailure(reply)) {
    if (reply.kind === 'unauthorized') {
      // Drop the dead token, keep the cursor: the rows already downloaded are
      // still downloaded, and a password prompt should not cost a full resync.
      await repo.writeSyncState({ ...state, token: null });
      return { kind: 'unauthorized' };
    }
    if (reply.kind === 'offline') return { kind: 'offline' };
    reportWarning('The server refused a sync round', reply);
    return { kind: 'refused', status: reply.status };
  }

  // The token and its account are only ever written together, so a reply that
  // names another account is a defect somewhere. Its rows are not this
  // device's to keep: nothing is applied, the queue stays, the cursor stays.
  // What this round uploaded has already gone wherever the token points.
  if (reply.userId !== undefined && state.userId !== null && reply.userId !== state.userId) {
    reportError('A sync reply named another account than the one this device holds', {
      stored: state.userId,
      reply: reply.userId,
    });
    return { kind: 'refused', status: null };
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

  // A device from before accounts learns its owner from the first reply that
  // names one. An owner it already has is never replaced here: a different one
  // stopped the round above.
  await repo.writeSyncState({
    ...state,
    userId: state.userId ?? reply.userId ?? null,
    cursor: reply.serverTime,
  });

  // Cleared only if it is still the marker this round read: one raised while
  // the round was in flight is newer, survives, and the next round pays it.
  if (owed !== null) await repo.clearResyncOwed(owed);

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
export async function inspectFirstSync(
  deps: { send?: typeof apiClient.sync; repo?: BlockRepository } = {},
): Promise<FirstSyncLook> {
  const repo = deps.repo ?? liveRepository;
  const { joined } = await repo.readSyncState();
  if (joined) return { kind: 'already-joined' };
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
    await repo.writeSyncState({ ...state, cursor: reply.serverTime, joined: true });
    // Read AFTER the replacement, unlike runSyncOnce, and on purpose: the marker
    // this replacement raised is already paid — the replacement is the full
    // download, applied to every key. Reading before would leave that marker
    // standing and cost the next round a second full download. One raised by
    // another tab between this read and the clear survives, by the compare.
    const owed = await repo.readResyncOwed();
    if (owed !== null) await repo.clearResyncOwed(owed);
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

/**
 * The one way a token from outside the engine reaches this device.
 *
 * A device holds one account's rows. A session for that same account changes
 * the token and nothing else. A session for another account means the rows are
 * somebody else's, and they leave, after a copy when any of them has not
 * reached that somebody's cloud. A device from before accounts has no owner on
 * record, and only the person holding it can say whether its rows are theirs.
 *
 * Through the door like everything else here: it reads the queue a round is
 * busy emptying, and it writes the state a round is about to write.
 */
export function adoptSession(
  session: Session,
  answer: AdoptAnswer | null,
  deps: { repo?: BlockRepository; today?: () => string } = {},
): Promise<AdoptOutcome> {
  return oneAtATime(() => runAdoptSession(session, answer, deps));
}

async function runAdoptSession(
  session: Session,
  answer: AdoptAnswer | null,
  deps: { repo?: BlockRepository; today?: () => string },
): Promise<AdoptOutcome> {
  const repo = deps.repo ?? liveRepository;
  const today = deps.today ?? (() => new Date().toISOString().slice(0, 10));
  const state = await repo.readSyncState();

  if (state.userId === session.userId) {
    await repo.writeSyncState({ ...state, token: session.token });
    return { kind: 'adopted' };
  }

  // Not the same account, or not known to be: the cursor goes as well. One
  // taken from another account's stream would skip every row stamped before it.
  const fresh = { token: session.token, userId: session.userId, cursor: null, joined: false };

  if (state.userId === null) {
    const rows = await repo.countLocalRows();
    if (rows > 0 && answer === null) return { kind: 'unknown-owner', rows };
    if (rows > 0 && answer === 'discard') await resetDevice(repo, today(), true);
    // 'keep' leaves the rows to the first-sync question, which asks again when
    // the cloud holds rows too. It is never a merge made here.
    await repo.writeSyncState(fresh);
    return { kind: 'adopted' };
  }

  const atRisk = await countAtRisk(repo, state.joined);
  // 'keep' is no answer for rows known to be another account's.
  if (atRisk > 0 && answer !== 'discard') return { kind: 'other-account', atRisk };
  await resetDevice(repo, today(), atRisk > 0);
  await repo.writeSyncState(fresh);
  return { kind: 'adopted' };
}

/**
 * What would be lost for good if this device's rows left now. A joined device
 * has delivered everything but its queue; one that never joined has delivered
 * nothing at all, queued or not.
 */
async function countAtRisk(repo: BlockRepository, joined: boolean): Promise<number> {
  if (!joined) return repo.countLocalRows();
  const pending = await repo.listPending();
  return pending.projects.length + pending.plans.length + pending.overrides.length;
}

/**
 * Rows, queue and full-download marker, emptied in one step; the sync state is
 * the caller's to write. The copy comes first, as in take-the-cloud.
 */
async function resetDevice(repo: BlockRepository, stamp: string, keepCopy: boolean): Promise<void> {
  if (keepCopy) await repo.keepDiscardedCopy(stamp);
  // `[]`, never a removed key: `ensureMigrated` refills a missing v2 key from
  // tt.*.v1, and those rows belong to whoever used this device before.
  await repo.replaceAllFromServer({ projects: [], plans: [], overrides: [] });
  // Overwriting a damaged key just raised the marker. The next owner starts at
  // cursor null, which is the full download it asks for.
  const owed = await repo.readResyncOwed();
  if (owed !== null) await repo.clearResyncOwed(owed);
}
