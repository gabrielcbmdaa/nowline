import { useSyncExternalStore } from 'react';
import { toDateKey } from '../domain/dates';
import { newId, startTimer, stopTimer } from '../domain/timer';
import type { BlockOverride, BlockPlan, Project } from '../domain/types';
import { repository } from '../storage/localStorageRepository';

export type TabId = 'calendar' | 'summary' | 'projects';

export type AppState = {
  loaded: boolean;
  tab: TabId;
  projects: Project[];
  plans: BlockPlan[];
  overrides: BlockOverride[];
  /** Advanced by the clock tick; every live-growing block reads it. */
  now: Date;
  /** The day currently on screen; the add button creates blocks here. */
  visibleDate: string;
};

/** Everything fits in memory: a year of blocks is well under a megabyte. */
let state: AppState = {
  loaded: false,
  tab: 'calendar',
  projects: [],
  plans: [],
  overrides: [],
  now: new Date(),
  visibleDate: toDateKey(new Date()),
};

const listeners = new Set<() => void>();

function setState(patch: Partial<AppState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getState(): AppState {
  return state;
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState);
}

export async function loadAll(): Promise<void> {
  const [projects, plans, overrides] = await Promise.all([
    repository.listProjects(),
    repository.listPlans(),
    repository.listOverrides(),
  ]);
  setState({ projects, plans, overrides, loaded: true, now: new Date() });
}

export function setTab(tab: TabId): void {
  setState({ tab });
}

export function setVisibleDate(visibleDate: string): void {
  if (state.visibleDate !== visibleDate) setState({ visibleDate });
}

function replaceById<T extends { id: string }>(rows: T[], row: T): T[] {
  const index = rows.findIndex((existing) => existing.id === row.id);
  if (index === -1) return [...rows, row];
  const next = rows.slice();
  next[index] = row;
  return next;
}

export async function saveProject(project: Project): Promise<void> {
  await repository.saveProject(project);
  setState({ projects: replaceById(state.projects, project) });
}

export async function deleteProject(id: string): Promise<void> {
  await repository.deleteProject(id);
  setState({
    projects: state.projects.filter((project) => project.id !== id),
    plans: state.plans.map((plan) =>
      plan.projectId === id ? { ...plan, projectId: null } : plan,
    ),
  });
}

export async function savePlan(plan: BlockPlan): Promise<void> {
  await repository.savePlan(plan);
  setState({ plans: replaceById(state.plans, plan) });
}

export async function deletePlan(id: string): Promise<void> {
  await repository.deletePlan(id);
  setState({
    plans: state.plans.filter((plan) => plan.id !== id),
    overrides: state.overrides.filter((override) => override.planId !== id),
  });
}

export async function saveOverride(override: BlockOverride): Promise<void> {
  await repository.saveOverride(override);
  setState({ overrides: replaceById(state.overrides, override) });
}

export async function deleteOverride(id: string): Promise<void> {
  await repository.deleteOverride(id);
  setState({ overrides: state.overrides.filter((o) => o.id !== id) });
}

export function getRunningOverride(current: AppState = state): BlockOverride | null {
  return current.overrides.find((override) => override.status === 'running') ?? null;
}

/**
 * Start and stop share one queue so two Play taps cannot both pass "stop
 * the current one" before either has written the new running override.
 * Only the public functions take the lock: start already calls stop inside,
 * and a second lock there would wait on itself.
 */
let timerQueue: Promise<void> = Promise.resolve();

function enqueueTimerTransition(op: () => Promise<void>): Promise<void> {
  const run = timerQueue.then(op, op);
  timerQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function startTimerForUnlocked(planId: string, date: string): Promise<void> {
  const now = new Date();
  await stopRunningTimerUnlocked(now);

  const existing =
    state.overrides.find(
      (override) => override.planId === planId && override.date === date,
    ) ?? null;

  await saveOverride(startTimer(planId, date, now, existing));
}

async function stopRunningTimerUnlocked(now: Date): Promise<void> {
  const running = getRunningOverride();
  if (!running) return;
  await saveOverride(stopTimer(running, now));
}

/**
 * Play. Any timer already running is stopped first: the app tracks one thing
 * at a time, so two overlapping totals can never exist.
 */
export async function startTimerFor(planId: string, date: string): Promise<void> {
  await enqueueTimerTransition(() => startTimerForUnlocked(planId, date));
}

export async function stopRunningTimer(now: Date = new Date()): Promise<void> {
  await enqueueTimerTransition(() => stopRunningTimerUnlocked(now));
}

/** Repaints every 30 s: half a minute is half a pixel, so nothing finer helps. */
export function startClock(): () => void {
  const id = window.setInterval(() => setState({ now: new Date() }), 30_000);
  return () => window.clearInterval(id);
}

export { newId, toDateKey };
