import { compareDateKeys } from './dates';
import { trackedSeconds } from './timer';
import type { BlockOverride, BlockPlan, Project } from './types';

export type ProjectTotal = {
  project: Project | null;
  seconds: number;
};

/**
 * Sums are done in seconds and rounded only when displayed, so a long list
 * of short blocks cannot drift.
 */
export function totalsByProject(
  plans: BlockPlan[],
  overrides: BlockOverride[],
  projects: Project[],
  fromDate: string,
  toDate: string,
): ProjectTotal[] {
  const planById = new Map(plans.map((plan) => [plan.id, plan]));
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const totals = new Map<string | null, { project: Project | null; seconds: number }>();

  for (const override of overrides) {
    if (override.status !== 'done') continue;
    if (compareDateKeys(override.date, fromDate) < 0) continue;
    if (compareDateKeys(override.date, toDate) > 0) continue;

    const plan = planById.get(override.planId);
    if (!plan) continue; // An override with no plan is leftover data.

    // Resolve the project before choosing the key, so dangling references
    // collapse into the same bucket as explicit null projects.
    const project = plan.projectId ? projectById.get(plan.projectId) ?? null : null;
    const key = project?.id ?? null;

    const current = totals.get(key) || { project, seconds: 0 };
    totals.set(key, {
      project,
      seconds: current.seconds + trackedSeconds(override),
    });
  }

  return [...totals.values()].sort((a, b) => b.seconds - a.seconds);
}

export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
