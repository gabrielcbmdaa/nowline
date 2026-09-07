import { compareDateKeys } from '../domain/dates';
import { reportWarning } from '../reportError';
import type { BlockOverride, BlockPlan, Project } from '../domain/types';
import type { BlockRepository } from './repository';

const PROJECTS_KEY = 'tt.projects.v1';
const PLANS_KEY = 'tt.plans.v1';
const OVERRIDES_KEY = 'tt.overrides.v1';

/** The only file in the app allowed to mention localStorage. */
export class LocalStorageRepository implements BlockRepository {
  /**
   * The clock is a parameter so a test can freeze it. Every updatedAt in the
   * app comes from here and from nowhere else: one writer cannot forget.
   */
  constructor(private readonly now: () => Date = () => new Date()) {}

  private stamp<T>(row: T): T & { updatedAt: string } {
    return { ...row, updatedAt: this.now().toISOString() };
  }

  async listProjects(): Promise<Project[]> {
    return this.read<Project>(PROJECTS_KEY);
  }

  async saveProject(project: Project): Promise<void> {
    this.write(PROJECTS_KEY, upsert(this.read<Project>(PROJECTS_KEY), this.stamp(project)));
  }

  async deleteProject(id: string): Promise<void> {
    this.write(
      PROJECTS_KEY,
      this.read<Project>(PROJECTS_KEY).filter((project) => project.id !== id),
    );
    // Blocks outlive their project; they simply lose their colour.
    this.write(
      PLANS_KEY,
      this.read<BlockPlan>(PLANS_KEY).map((plan) =>
        plan.projectId === id ? { ...plan, projectId: null } : plan,
      ),
    );
  }

  async listPlans(): Promise<BlockPlan[]> {
    return this.read<BlockPlan>(PLANS_KEY);
  }

  async savePlan(plan: BlockPlan): Promise<void> {
    this.write(PLANS_KEY, upsert(this.read<BlockPlan>(PLANS_KEY), this.stamp(plan)));
  }

  async deletePlan(id: string): Promise<void> {
    this.write(
      PLANS_KEY,
      this.read<BlockPlan>(PLANS_KEY).filter((plan) => plan.id !== id),
    );
    // An override with no plan is unreachable data; drop it with the plan.
    this.write(
      OVERRIDES_KEY,
      this.read<BlockOverride>(OVERRIDES_KEY).filter(
        (override) => override.planId !== id,
      ),
    );
  }

  async listOverrides(fromDate?: string, toDate?: string): Promise<BlockOverride[]> {
    const overrides = this.read<BlockOverride>(OVERRIDES_KEY);
    if (!fromDate || !toDate) return overrides;
    return overrides.filter(
      (override) =>
        compareDateKeys(override.date, fromDate) >= 0 &&
        compareDateKeys(override.date, toDate) <= 0,
    );
  }

  async saveOverride(override: BlockOverride): Promise<void> {
    this.write(
      OVERRIDES_KEY,
      upsert(this.read<BlockOverride>(OVERRIDES_KEY), this.stamp(override)),
    );
  }

  async deleteOverride(id: string): Promise<void> {
    this.write(
      OVERRIDES_KEY,
      this.read<BlockOverride>(OVERRIDES_KEY).filter((o) => o.id !== id),
    );
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
