import { useSyncExternalStore } from 'react';
import { toDateKey } from '../domain/dates';
import { newId, startTimer, stopTimer } from '../domain/timer';
import type { BlockOverride, BlockPlan, Project } from '../domain/types';
import { repository } from '../storage/repository';
import { syncOnce } from '../storage/sync';

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

export async function saveProject(project: Project): Promise<void> {
  await repository.saveProject(project);
  // Reload this kind instead of parking the caller's object: the repository
  // just stamped updatedAt, and two copies that disagree is exactly the bug.
  setState({ projects: await repository.listProjects() });
  syncSoon();
}

export async function deleteProject(id: string): Promise<void> {
  await repository.deleteProject(id);
  // Reload instead of patching memory: the repository just stamped rows this
  // function does not see, and two copies that disagree is exactly the bug.
  await loadAll();
  syncSoon();
}

export async function savePlan(plan: BlockPlan): Promise<void> {
  await repository.savePlan(plan);
  setState({ plans: await repository.listPlans() });
  syncSoon();
}

export async function deletePlan(id: string): Promise<void> {
  await repository.deletePlan(id);
  // Reload instead of patching memory: the repository just stamped rows this
  // function does not see, and two copies that disagree is exactly the bug.
  await loadAll();
  syncSoon();
}

export async function saveOverride(override: BlockOverride): Promise<void> {
  await repository.saveOverride(override);
  setState({ overrides: await repository.listOverrides() });
  syncSoon();
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

async function startTimerForUnlocked(planId: string, date: string, now: Date): Promise<void> {
  // Re-read from the repository rather than trusting this tab's cache.
  // This narrows the race to the gap between the read and the write;
  // making it airtight needs an atomic operation in the repository.
  const overrides = await repository.listOverrides();
  setState({ overrides });

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
  const now = new Date();
  await enqueueTimerTransition(() => startTimerForUnlocked(planId, date, now));
  syncSoon();
}

export async function stopRunningTimer(now: Date = new Date()): Promise<void> {
  await enqueueTimerTransition(() => stopRunningTimerUnlocked(now));
  syncSoon();
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

/** One round, then refresh what is on screen if anything arrived. */
export async function syncNow(): Promise<void> {
  const outcome = await syncOnce();
  if (outcome.kind === 'done' && outcome.downloaded > 0) await loadAll();
}

/**
 * The four moments the design document names, and why each one is there:
 * opening the app is when you are looking at it; coming back to the front is
 * a phone leaving a pocket; two seconds after a write groups a drag into one
 * request instead of thirty; five minutes is the safety net for a screen
 * nobody is touching.
 */
export function startSyncing(): () => void {
  void syncNow();

  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow();
  };
  document.addEventListener('visibilitychange', onVisible);

  const every5Minutes = setInterval(() => void syncNow(), 5 * 60 * 1000);

  return () => {
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(every5Minutes);
    if (syncTimer !== null) clearTimeout(syncTimer);
  };
}

/** Called by every mutating function, after the write. */
function syncSoon(): void {
  if (syncTimer !== null) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void syncNow(), 2000);
}

/** Repaints every 30 s: half a minute is half a pixel, so nothing finer helps. */
export function startClock(): () => void {
  const id = window.setInterval(() => setState({ now: new Date() }), 30_000);
  return () => window.clearInterval(id);
}

export { newId };
