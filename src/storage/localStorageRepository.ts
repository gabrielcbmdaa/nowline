import { compareDateKeys } from '../domain/dates';
import { reportWarning } from '../reportError';
import type { BlockOverride, BlockPlan, Project } from '../domain/types';
import type { BlockRepository } from './repository';

const PROJECTS_KEY = 'nowline.projects.v2';
const PLANS_KEY = 'nowline.plans.v2';
const OVERRIDES_KEY = 'nowline.overrides.v2';
const PENDING_KEY = 'nowline.pending.v1';

export type PendingIds = {
  projects: string[];
  plans: string[];
  overrides: string[];
};

const nothingPending = (): PendingIds => ({ projects: [], plans: [], overrides: [] });

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

  private stamp<T>(row: T): T & { updatedAt: string } {
    return { ...row, updatedAt: this.now().toISOString() };
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
    this.write(PROJECTS_KEY, upsert(this.read<Project>(PROJECTS_KEY), this.stamp(project)));
  }

  async deleteProject(id: string): Promise<void> {
    this.ensureMigrated();
    const at = this.now().toISOString();

    // Blocks outlive their project; they simply lose their colour. Each one is a
    // row that changed, so each one needs its own new updatedAt: without it the
    // other device would hand the colour straight back.
    const plans = this.read<BlockPlan>(PLANS_KEY);
    this.markPending('projects', id);
    for (const row of plans) {
      if (row.projectId === id) this.markPending('plans', row.id);
    }

    this.write(
      PROJECTS_KEY,
      this.read<Project>(PROJECTS_KEY).map((row) =>
        row.id === id ? { ...row, deletedAt: at, updatedAt: at } : row,
      ),
    );
    this.write(
      PLANS_KEY,
      plans.map((row) =>
        row.projectId === id ? { ...row, projectId: null, updatedAt: at } : row,
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
    this.write(PLANS_KEY, upsert(this.read<BlockPlan>(PLANS_KEY), this.stamp(plan)));
  }

  async deletePlan(id: string): Promise<void> {
    this.ensureMigrated();
    const at = this.now().toISOString();

    this.markPending('plans', id);

    this.write(
      PLANS_KEY,
      this.read<BlockPlan>(PLANS_KEY).map((row) =>
        row.id === id ? { ...row, deletedAt: at, updatedAt: at } : row,
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
    this.write(
      OVERRIDES_KEY,
      upsert(this.read<BlockOverride>(OVERRIDES_KEY), this.stamp(override)),
    );
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

  async clearPending(ids: PendingIds): Promise<void> {
    this.ensureMigrated();
    this.unmarkPending('projects', ids.projects);
    this.unmarkPending('plans', ids.plans);
    this.unmarkPending('overrides', ids.overrides);
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
