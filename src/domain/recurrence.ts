import { atMinute, compareDateKeys, weekdayOf } from './dates';
import type {
  BlockOverride,
  BlockPlan,
  Project,
  ResolvedOccurrence,
} from './types';

export function planAppliesOn(plan: BlockPlan, date: string): boolean {
  if (compareDateKeys(date, plan.anchorDate) < 0) return false;
  if (plan.endDate && compareDateKeys(date, plan.endDate) > 0) return false;

  switch (plan.recurrence.type) {
    case 'none':
      return date === plan.anchorDate;
    case 'daily':
      return true;
    case 'weekly':
      return plan.recurrence.weekdays.includes(weekdayOf(date));
  }
}

export function overrideKey(planId: string, date: string): string {
  return `${planId}|${date}`;
}

export function indexOverrides(overrides: BlockOverride[]): Map<string, BlockOverride> {
  const index = new Map<string, BlockOverride>();
  for (const override of overrides) {
    index.set(overrideKey(override.planId, override.date), override);
  }
  return index;
}

/**
 * Turns "the paper on the fridge plus the note written on top of it" into
 * something the calendar can draw. Returns null when this day was deleted.
 */
export function resolveOccurrence(
  plan: BlockPlan,
  override: BlockOverride | null,
  project: Project | null,
  date: string,
  now: Date,
): ResolvedOccurrence | null {
  if (override?.status === 'deleted') return null;

  const plannedDurationMs =
    (override?.durationMinutes ?? plan.durationMinutes) * 60000;

  let status: ResolvedOccurrence['status'] = 'scheduled';
  let displayStart: Date;
  let displayEnd: Date;

  if (override?.status === 'done' && override.actualStart && override.actualEnd) {
    status = 'done';
    displayStart = new Date(override.actualStart);
    displayEnd = new Date(override.actualEnd);
  } else if (override?.status === 'running' && override.actualStart) {
    status = 'running';
    displayStart = new Date(override.actualStart);
    // Sits still at its planned length, then follows the clock.
    displayEnd = new Date(
      Math.max(displayStart.getTime() + plannedDurationMs, now.getTime()),
    );
  } else {
    displayStart = atMinute(date, override?.startMinute ?? plan.startMinute);
    displayEnd = new Date(displayStart.getTime() + plannedDurationMs);
  }

  return {
    planId: plan.id,
    date,
    title: plan.title,
    project,
    status,
    displayStart,
    displayEnd,
  };
}

export function occurrencesForDay(
  plans: BlockPlan[],
  overrideIndex: Map<string, BlockOverride>,
  projectsById: Map<string, Project>,
  date: string,
  now: Date,
): ResolvedOccurrence[] {
  const occurrences: ResolvedOccurrence[] = [];

  for (const plan of plans) {
    const override = overrideIndex.get(overrideKey(plan.id, date)) ?? null;
    if (!planAppliesOn(plan, date)) {
      if (override?.status !== 'done' && override?.status !== 'running') continue;
    }
    const project = plan.projectId ? projectsById.get(plan.projectId) ?? null : null;
    const resolved = resolveOccurrence(plan, override, project, date, now);
    if (resolved) occurrences.push(resolved);
  }

  return occurrences.sort(
    (a, b) => a.displayStart.getTime() - b.displayStart.getTime(),
  );
}
