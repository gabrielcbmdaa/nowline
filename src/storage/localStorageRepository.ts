import { compareDateKeys } from '../domain/dates';
import { reportWarning } from '../reportError';
import type { BlockOverride, BlockPlan, Project } from '../domain/types';
import type { SyncChanges, SyncRow } from './apiClient';
import type { BlockRepository } from './repository';

const PROJECTS_KEY = 'nowline.projects.v2';
const PLANS_KEY = 'nowline.plans.v2';
const OVERRIDES_KEY = 'nowline.overrides.v2';
const PENDING_KEY = 'nowline.pending.v1';
const SYNC_KEY = 'nowline.sync.v1';

export type SyncState = { token: string | null; cursor: string | null; joined: boolean };

export type PendingIds = {
  projects: string[];
  plans: string[];
  overrides: string[];
};

export type SentRow = { id: string; updatedAt: string };
export type SentRows = { projects: SentRow[]; plans: SentRow[]; overrides: SentRow[] };

const nothingPending = (): PendingIds => ({ projects: [], plans: [], overrides: [] });

/** One millisecond later, in the same ISO shape the rest of the app compares as text. */
function nextInstantAfter(stamp: string): string {
  return new Date(Date.parse(stamp) + 1).toISOString();
}

/**
 * The keys this app was born with, under the name it had before Nowline. They
 * are read once and then left alone on purpose: while they sit there, the
 * migration is reversible.
 *
 * This whole block — `LEGACY_KEYS`, `ensureMigrated`, and the calls to it at
 * the top of every public method — exists only to carry rows written under
 * the old name onto a device that has not opened the app since the rename,
 * and it does that at most once per device. It earns its keep only until
 * every device in use has synced at least once against the server: after
 * that point a device that never migrated simply arrives with an empty
 * store and downloads its rows from there instead, so the migration stops
 * being the only way back to them. Once that day has come, delete it by
 * removing `LEGACY_KEYS`, `ensureMigrated`, and its call sites — the
 * compiler will point at all three.
 */
const LEGACY_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['tt.projects.v1', PROJECTS_KEY],
  ['tt.plans.v1', PLANS_KEY],
  ['tt.overrides.v1', OVERRIDES_KEY],
];

/** The only file in the app allowed to mention localStorage. */
export class LocalStorageRepository implements BlockRepository {
  /**
   * The clock is a parameter so a test can freeze it. Every updatedAt in the
   * app comes from here and from nowhere else: one writer cannot forget.
   */
  constructor(private readonly now: () => Date = () => new Date()) {}

  private migrated = false;

  /**
   * Runs at the top of every public method rather than in the constructor:
   * the constructor runs at import time, where a node test has no localStorage.
   * And it has to cover writes too — a save before any read would create the v2
   * key with one row and leave every v1 row behind for good.
   *
   * `migrated` is set only once every pair has copied cleanly, not before the loop
   * starts. The realistic way this throws is a full quota — the migration roughly
   * doubles the origin's stored bytes while both key sets coexist — and if that hit
   * were still recorded as "done", the retry button in the UI would reuse this same
   * instance, see `migrated === true`, skip straight past the untouched v1 rows, and
   * render an empty calendar that looks like a successful, empty load instead of the
   * failure it is. Leaving it false lets that same retry try again, and the per-pair
   * `to`-key guard below makes that safe: a pair that already copied is skipped, so
   * only the ones that did not finish are repeated.
   */
  private ensureMigrated(): void {
    if (this.migrated) return;

    for (const [from, to] of LEGACY_KEYS) {
      if (localStorage.getItem(to) !== null) continue;
      const legacy = this.read<{ id: string }>(from);
      if (legacy.length === 0) continue;
      const stampedAt = this.now().toISOString();
      this.write(
        to,
        legacy.map((row) => {
          if (to === OVERRIDES_KEY) {
            const { deletedAt: _tombstone, ...withoutTombstone } = row as {
              id: string;
              deletedAt?: unknown;
            };
            return { ...withoutTombstone, updatedAt: stampedAt };
          }
          return { deletedAt: null, ...row, updatedAt: stampedAt };
        }),
      );
    }

    this.migrated = true;
  }

  /**
   * The only place in this class that writes an `updatedAt`.
   *
   * Every row that changes gets a stamp strictly newer than its own previous
   * one. Two writes of a row inside one millisecond used to share a stamp, and
   * a shared stamp is a change that never travels: the confirmation of the
   * first upload cannot tell the second version from the one it sent. That bit
   * the tombstones first, because deleting used to write `updatedAt` on its
   * own, without ever looking at what the row already carried.
   */
  private touch<T extends { id: string; updatedAt: string }>(
    row: T,
    existing: readonly T[],
    changes: Partial<T> = {},
  ): T {
    const now = this.now().toISOString();
    const previous = existing.find((stored) => stored.id === row.id)?.updatedAt;
    return {
      ...row,
      ...changes,
      updatedAt: previous !== undefined && now <= previous ? nextInstantAfter(previous) : now,
    };
  }

  async listProjects(): Promise<Project[]> {
    this.ensureMigrated();
    return this.read<Project>(PROJECTS_KEY).filter((row) => row.deletedAt === null);
  }

  async saveProject(project: Project): Promise<void> {
    this.ensureMigrated();
    // Queue first: if the row write then fills storage, the id is still owed.
    // The other way around persists a change the server never hears about.
    this.markPending('projects', project.id);
    const rows = this.read<Project>(PROJECTS_KEY);
    this.write(PROJECTS_KEY, upsert(rows, this.touch(project, rows)));
  }

  async deleteProject(id: string): Promise<void> {
    this.ensureMigrated();

    // Blocks outlive their project; they simply lose their colour. Each one is a
    // row that changed, so each one needs its own new updatedAt: without it the
    // other device would hand the colour straight back.
    const projects = this.read<Project>(PROJECTS_KEY);
    const plans = this.read<BlockPlan>(PLANS_KEY);
    this.markPending('projects', id);
    for (const row of plans) {
      if (row.projectId === id) this.markPending('plans', row.id);
    }

    this.write(
      PROJECTS_KEY,
      projects.map((row) =>
        row.id === id
          ? this.touch(row, projects, { deletedAt: this.now().toISOString() } as Partial<Project>)
          : row,
      ),
    );
    this.write(
      PLANS_KEY,
      plans.map((row) =>
        row.projectId === id ? this.touch(row, plans, { projectId: null }) : row,
      ),
    );
  }

  async listPlans(): Promise<BlockPlan[]> {
    this.ensureMigrated();
    return this.read<BlockPlan>(PLANS_KEY).filter((row) => row.deletedAt === null);
  }

  async savePlan(plan: BlockPlan): Promise<void> {
    this.ensureMigrated();
    this.markPending('plans', plan.id);
    const rows = this.read<BlockPlan>(PLANS_KEY);
    this.write(PLANS_KEY, upsert(rows, this.touch(plan, rows)));
  }

  async deletePlan(id: string): Promise<void> {
    this.ensureMigrated();

    this.markPending('plans', id);

    const rows = this.read<BlockPlan>(PLANS_KEY);
    this.write(
      PLANS_KEY,
      rows.map((row) =>
        row.id === id
          ? this.touch(row, rows, { deletedAt: this.now().toISOString() } as Partial<BlockPlan>)
          : row,
      ),
    );
    // An override carries no tombstone of its own: it only exists hanging off a
    // plan, so the plan's tombstone already tells the other device it is gone too.
    const overrides = this.read<BlockOverride>(OVERRIDES_KEY);
    const dropped = overrides
      .filter((override) => override.planId === id)
      .map((override) => override.id);
    this.write(
      OVERRIDES_KEY,
      overrides.filter((override) => override.planId !== id),
    );
    // Unmark after the drop: doing it first would unqueue rows that are still
    // stored if the write then fails.
    this.unmarkPending('overrides', dropped);
  }

  async listOverrides(fromDate?: string, toDate?: string): Promise<BlockOverride[]> {
    this.ensureMigrated();
    const overrides = this.read<BlockOverride>(OVERRIDES_KEY);
    if (!fromDate || !toDate) return overrides;
    return overrides.filter(
      (override) =>
        compareDateKeys(override.date, fromDate) >= 0 &&
        compareDateKeys(override.date, toDate) <= 0,
    );
  }

  async saveOverride(override: BlockOverride): Promise<void> {
    this.ensureMigrated();
    this.markPending('overrides', override.id);
    const rows = this.read<BlockOverride>(OVERRIDES_KEY);
    this.write(OVERRIDES_KEY, upsert(rows, this.touch(override, rows)));
  }

  async deleteOverride(id: string): Promise<void> {
    this.ensureMigrated();
    this.write(
      OVERRIDES_KEY,
      this.read<BlockOverride>(OVERRIDES_KEY).filter((o) => o.id !== id),
    );
    this.unmarkPending('overrides', [id]);
  }

  /**
   * Sync uploads what the queue lists, and nothing else. A corrupt queue
   * is therefore a lost upload, not an extra one: those rows stay unsent
   * until they happen to change again. Recover by treating every row this
   * device still holds as owed — including tombstones, which have to reach
   * the server like any other change. Recovering is a real event; swallow
   * it and the next person debugging starts from the symptom alone.
   */
  private recoverCorruptPending(whatWasWrong: string, detail: unknown): PendingIds {
    reportWarning(`${whatWasWrong}; treating every stored row as owed`, detail);
    return this.everythingPending();
  }

  private everythingPending(): PendingIds {
    return {
      projects: this.read<Project>(PROJECTS_KEY).map((row) => row.id),
      plans: this.read<BlockPlan>(PLANS_KEY).map((row) => row.id),
      overrides: this.read<BlockOverride>(OVERRIDES_KEY).map((row) => row.id),
    };
  }

  private readPending(): PendingIds {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      // Absent (null): this device has never queued a change. That is not
      // corruption. An empty string is the key present and damaged — a
      // truncated write — and must fall through to parse, not this branch.
      if (raw === null) return nothingPending();
      const parsed: unknown = JSON.parse(raw);
      // Arrays are objects. A stored `[]` would otherwise fall through and
      // look like a queue whose three kinds are all missing.
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return this.recoverCorruptPending(
          `Stored "${PENDING_KEY}" is not a pending-id object`,
          parsed,
        );
      }
      const rows = parsed as Partial<PendingIds>;
      // A kind that is not an array used to become `[]`, which is a lost
      // upload: those rows stay unsent until they happen to change again.
      // A number in an otherwise-shaped array is the same failure: a sync
      // layer would look up an id that cannot match any row.
      if (
        !isIdArray(rows.projects) ||
        !isIdArray(rows.plans) ||
        !isIdArray(rows.overrides)
      ) {
        return this.recoverCorruptPending(
          `Stored "${PENDING_KEY}" does not hold three id arrays`,
          parsed,
        );
      }
      return {
        projects: rows.projects,
        plans: rows.plans,
        overrides: rows.overrides,
      };
    } catch (error) {
      return this.recoverCorruptPending(`Reading "${PENDING_KEY}" from storage failed`, error);
    }
  }

  private markPending(kind: keyof PendingIds, id: string): void {
    const pending = this.readPending();
    if (!pending[kind].includes(id)) {
      pending[kind] = [...pending[kind], id];
    }
    // Always write. After a corrupt read, `pending` is the recovered set
    // and lives only in memory; returning early would leave the bad key.
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  }

  private unmarkPending(kind: keyof PendingIds, ids: readonly string[]): void {
    const pending = this.readPending();
    pending[kind] = pending[kind].filter((id) => !ids.includes(id));
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  }

  async listPending(): Promise<PendingIds> {
    this.ensureMigrated();
    return this.readPending();
  }

  /**
   * Rows by id, tombstones included. The three public list methods hide what
   * carries a `deletedAt` because the calendar must not draw it; the server
   * has to hear about it, or the other device hands the row straight back.
   */
  async rowsToUpload(pending: PendingIds): Promise<SyncChanges> {
    this.ensureMigrated();
    const pick = <T extends { id: string }>(key: string, ids: readonly string[]): T[] => {
      if (ids.length === 0) return [];
      const byId = new Map(this.read<T>(key).map((row) => [row.id, row]));
      // A queue can outlive its row; an id with nothing behind it is dropped
      // rather than sent as a hole.
      return ids.map((id) => byId.get(id)).filter((row): row is T => row !== undefined);
    };

    return {
      projects: pick<Project>(PROJECTS_KEY, pending.projects),
      plans: pick<BlockPlan>(PLANS_KEY, pending.plans),
      overrides: pick<BlockOverride>(OVERRIDES_KEY, pending.overrides),
    };
  }

  async readSyncState(): Promise<SyncState> {
    this.ensureMigrated();
    try {
      const raw = localStorage.getItem(SYNC_KEY);
      if (raw === null) return { token: null, cursor: null, joined: false };

      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) {
        reportWarning(`Stored "${SYNC_KEY}" is not an object`, parsed);
        return { token: null, cursor: null, joined: false };
      }

      const row = parsed as { token?: unknown; cursor?: unknown; joined?: unknown };
      // Read the two halves apart. A damaged cursor costs one full download;
      // dropping a good token with it costs the owner a password prompt for
      // nothing, and those are not the same price.
      return {
        token: typeof row.token === 'string' ? row.token : null,
        cursor: typeof row.cursor === 'string' ? row.cursor : null,
        joined: row.joined === true,
      };
    } catch (error) {
      reportWarning(`Reading "${SYNC_KEY}" from storage failed`, error);
      return { token: null, cursor: null, joined: false };
    }
  }

  async writeSyncState(next: SyncState): Promise<void> {
    this.ensureMigrated();
    localStorage.setItem(SYNC_KEY, JSON.stringify(next));
  }

  async clearPending(ids: PendingIds): Promise<void> {
    this.ensureMigrated();
    this.unmarkPending('projects', ids.projects);
    this.unmarkPending('plans', ids.plans);
    this.unmarkPending('overrides', ids.overrides);
  }

  /**
   * Write rows exactly as the server sent them: no new stamp, no queue entry.
   *
   * Using `savePlan` here would do both — it stamps with this device's clock
   * and marks the id as owed — and the two devices would then trade the same
   * row for ever, each one convinced it owes the other something.
   *
   * The newer `updatedAt` wins, which is the same rule the server applies. A
   * row this device edited while the answer was in flight keeps its edit.
   */
  async applyFromServer(changes: SyncChanges): Promise<void> {
    this.ensureMigrated();
    const merge = <T extends { id: string; updatedAt: string }>(
      key: string,
      arriving: readonly SyncRow[],
    ): void => {
      if (arriving.length === 0) return;
      const stored = this.read<T>(key);
      const byId = new Map(stored.map((row) => [row.id, row]));

      for (const row of arriving) {
        const mine = byId.get(row.id);
        if (mine === undefined || row.updatedAt > mine.updatedAt) {
          byId.set(row.id, row as unknown as T);
        }
      }
      this.write(key, [...byId.values()]);
    };

    merge<Project>(PROJECTS_KEY, changes.projects);
    merge<BlockPlan>(PLANS_KEY, changes.plans);
    merge<BlockOverride>(OVERRIDES_KEY, changes.overrides);
  }

  /**
   * Drop from the queue only the ids whose row still carries the `updatedAt`
   * that was sent. The queue holds ids and nothing else, so "forget p1" cannot
   * express "forget p1 only if it has not changed since I read it" — and the
   * gap between reading a row and confirming it is exactly one network round
   * trip wide, which is long enough for the owner to type.
   *
   * Read and write happen here, in one synchronous stretch, for the same
   * reason the server decides the winner inside the query: two steps with a
   * gap between them are two chances to lose the second one.
   */
  async clearPendingUnchanged(sent: SentRows): Promise<void> {
    this.ensureMigrated();
    const stillTheSame = <T extends { id: string; updatedAt: string }>(
      key: string,
      rows: readonly SentRow[],
    ): string[] => {
      if (rows.length === 0) return [];
      const byId = new Map(this.read<T>(key).map((row) => [row.id, row]));
      return rows
        .filter((row) => {
          const stored = byId.get(row.id);
          // A row that vanished is nothing this device still owes.
          return stored === undefined || stored.updatedAt === row.updatedAt;
        })
        .map((row) => row.id);
    };

    this.unmarkPending('projects', stillTheSame<Project>(PROJECTS_KEY, sent.projects));
    this.unmarkPending('plans', stillTheSame<BlockPlan>(PLANS_KEY, sent.plans));
    this.unmarkPending('overrides', stillTheSame<BlockOverride>(OVERRIDES_KEY, sent.overrides));
  }

  /** Every row this device holds, tombstones included, counted for the first-sync question. */
  async countLocalRows(): Promise<number> {
    this.ensureMigrated();
    return (
      this.read<Project>(PROJECTS_KEY).length +
      this.read<BlockPlan>(PLANS_KEY).length +
      this.read<BlockOverride>(OVERRIDES_KEY).length
    );
  }

  /**
   * A copy of everything local, under a key nothing reads. Nothing in this app
   * destroys the owner's data on a choice made once: the real data lives on a
   * phone, where there is no console to dig it back out of.
   */
  async keepDiscardedCopy(stamp: string): Promise<void> {
    this.ensureMigrated();
    localStorage.setItem(
      `nowline.discarded.${stamp}`,
      JSON.stringify({
        projects: this.read<Project>(PROJECTS_KEY),
        plans: this.read<BlockPlan>(PLANS_KEY),
        overrides: this.read<BlockOverride>(OVERRIDES_KEY),
      }),
    );
  }

  /** Every row this device holds becomes owed: what a device joining for the first time sends. */
  async queueEverything(): Promise<void> {
    this.ensureMigrated();
    localStorage.setItem(PENDING_KEY, JSON.stringify(this.everythingPending()));
  }

  /**
   * Throw away what is here and keep what arrived. Only the first-sync screen
   * calls this, and only after `keepDiscardedCopy`; the queue is emptied too,
   * because nothing local is owed any more.
   */
  async replaceAllFromServer(changes: SyncChanges): Promise<void> {
    this.ensureMigrated();
    this.write(PROJECTS_KEY, changes.projects);
    this.write(PLANS_KEY, changes.plans);
    this.write(OVERRIDES_KEY, changes.overrides);
    localStorage.setItem(PENDING_KEY, JSON.stringify(nothingPending()));
  }

  private read<T>(key: string): T[] {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (row): row is T =>
          row !== null &&
          typeof row === 'object' &&
          typeof (row as { id?: unknown }).id === 'string',
      );
    } catch (error) {
      reportWarning(`Reading "${key}" from storage failed`, error);
      // Corrupt storage must not brick the app; start from an empty list.
      return [];
    }
  }

  private write<T>(key: string, rows: T[]): void {
    localStorage.setItem(key, JSON.stringify(rows));
  }
}

function upsert<T extends { id: string }>(rows: T[], row: T): T[] {
  const index = rows.findIndex((existing) => existing.id === row.id);
  if (index === -1) return [...rows, row];
  const next = rows.slice();
  next[index] = row;
  return next;
}

function isIdArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
}
