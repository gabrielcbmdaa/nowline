// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockOverride, BlockPlan, Project } from '../domain/types';
import { repository } from '../storage/repository';
import {
  deletePlan,
  deleteProject,
  getState,
  loadAll,
  saveOverride,
  savePlan,
  saveProject,
  startTimerFor,
} from './store';

describe('store', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.useRealTimers();
    await loadAll();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('stops a running timer another tab wrote, not only the one in this tab’s cache', async () => {
    expect(getState().overrides).toEqual([]);

    const hiddenRunning: BlockOverride = {
      id: 'hidden',
      planId: 'p-other',
      date: '2026-09-03',
      status: 'running',
      actualStart: new Date(2026, 8, 3, 9, 0, 0).toISOString(),
      actualEnd: null,
      startMinute: null,
      durationMinutes: null,
      updatedAt: new Date(2026, 8, 3, 9, 0, 0).toISOString(),
    };
    localStorage.setItem('nowline.overrides.v2', JSON.stringify([hiddenRunning]));

    await startTimerFor('p-this', '2026-09-03');

    const stored = JSON.parse(localStorage.getItem('nowline.overrides.v2')!) as BlockOverride[];
    const running = stored.filter((override) => override.status === 'running');
    expect(running).toHaveLength(1);
    expect(running[0].planId).toBe('p-this');
    expect(stored.find((override) => override.id === 'hidden')?.status).toBe('done');
    expect(getState().overrides.find((override) => override.id === 'hidden')?.status).toBe(
      'done',
    );
  });

  it('records the instant Play was tapped, not when the queued write ran', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 10, 0, 0));

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let firstSaveStarted!: () => void;
    const sawFirstSave = new Promise<void>((resolve) => {
      firstSaveStarted = resolve;
    });

    let holdingFirst = true;
    const originalSave = repository.saveOverride.bind(repository);
    vi.spyOn(repository, 'saveOverride').mockImplementation(async (override) => {
      if (holdingFirst) {
        holdingFirst = false;
        firstSaveStarted();
        await held;
      }
      return originalSave(override);
    });

    const occupying = startTimerFor('p-occupy', '2026-09-03');
    await sawFirstSave;

    const play = startTimerFor('p-real', '2026-09-03');
    vi.setSystemTime(new Date(2026, 8, 3, 10, 0, 10));
    release();
    await occupying;
    await play;

    const started = getState().overrides.find((override) => override.planId === 'p-real');
    expect(started?.actualStart).toBe(new Date(2026, 8, 3, 10, 0, 0).toISOString());
  });

  it('re-reads overrides through the storage seam before starting a timer', async () => {
    const listSpy = vi.spyOn(repository, 'listOverrides');
    await startTimerFor('p1', '2026-09-03');
    expect(listSpy).toHaveBeenCalled();
  });

  it('reloads after deleting a project, so a plan it unassigns carries the delete-time stamp in memory', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 9, 0, 0));

    const savedAt = new Date(2026, 8, 3, 9, 0, 0).toISOString();
    const testProject: Project = {
      id: 'health',
      name: 'Health',
      color: '#E5484D',
      createdAt: savedAt,
      updatedAt: savedAt,
      deletedAt: null,
    };
    const testPlan: BlockPlan = {
      id: 'p1',
      title: 'Make exercise',
      projectId: 'health',
      startMinute: 300,
      durationMinutes: 120,
      recurrence: { type: 'daily' },
      anchorDate: '2026-09-03',
      endDate: null,
      createdAt: savedAt,
      updatedAt: savedAt,
      deletedAt: null,
    };
    await saveProject(testProject);
    await savePlan(testPlan);

    // A hand-patched copy could not know this: it only exists because the store
    // reloaded from the repository after the delete stamped it.
    const deletedAt = new Date(2026, 8, 3, 10, 0, 0).toISOString();
    vi.setSystemTime(new Date(2026, 8, 3, 10, 0, 0));
    await deleteProject('health');

    const plan = getState().plans.find((row) => row.id === 'p1');
    expect(plan?.projectId).toBeNull();
    expect(plan?.updatedAt).not.toBe(savedAt);
    expect(plan?.updatedAt).toBe(deletedAt);
  });

  it('reloads after deleting a plan, so the buried plan keeps its delete-time stamp in storage', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 3, 9, 0, 0));

    const savedAt = new Date(2026, 8, 3, 9, 0, 0).toISOString();
    const testPlan: BlockPlan = {
      id: 'p1',
      title: 'Make exercise',
      projectId: null,
      startMinute: 300,
      durationMinutes: 120,
      recurrence: { type: 'daily' },
      anchorDate: '2026-09-03',
      endDate: null,
      createdAt: savedAt,
      updatedAt: savedAt,
      deletedAt: null,
    };
    await savePlan(testPlan);

    const hiddenRunning: BlockOverride = {
      id: 'o1',
      planId: 'p1',
      date: '2026-09-03',
      status: 'done',
      actualStart: savedAt,
      actualEnd: savedAt,
      startMinute: null,
      durationMinutes: null,
      updatedAt: savedAt,
    };
    localStorage.setItem('nowline.overrides.v2', JSON.stringify([hiddenRunning]));
    await loadAll();

    // A reload keeps the buried row in storage with its own fresh delete-time
    // stamp, but listPlans filters it out, so the state does not hold deleted rows.
    const deletedAt = new Date(2026, 8, 3, 10, 0, 0).toISOString();
    vi.setSystemTime(new Date(2026, 8, 3, 10, 0, 0));
    await deletePlan('p1');

    // The plan is deleted and filtered out of the list, so it is not in state.
    const plan = getState().plans.find((row) => row.id === 'p1');
    expect(plan).toBeUndefined();
    expect(getState().overrides).toEqual([]);

    // Verify the plan is still in storage with deletedAt set.
    const rawPlans = JSON.parse(localStorage.getItem('nowline.plans.v2') ?? '[]');
    expect(rawPlans).toHaveLength(1);
    expect(rawPlans[0].id).toBe('p1');
    expect(rawPlans[0].deletedAt).toBe(deletedAt);
    expect(rawPlans[0].updatedAt).toBe(deletedAt);
  });

  it('keeps the row in memory equal to the row in storage after a save', async () => {
    vi.useFakeTimers();
    const callerAt = new Date(2026, 8, 3, 9, 0, 0).toISOString();
    const stampedAt = new Date(2026, 8, 3, 10, 0, 0).toISOString();
    vi.setSystemTime(new Date(2026, 8, 3, 10, 0, 0));

    const testProject: Project = {
      id: 'health',
      name: 'Health',
      color: '#E5484D',
      createdAt: callerAt,
      updatedAt: callerAt,
      deletedAt: null,
    };
    const testPlan: BlockPlan = {
      id: 'p1',
      title: 'Make exercise',
      projectId: 'health',
      startMinute: 300,
      durationMinutes: 120,
      recurrence: { type: 'daily' },
      anchorDate: '2026-09-03',
      endDate: null,
      createdAt: callerAt,
      updatedAt: callerAt,
      deletedAt: null,
    };
    const testOverride: BlockOverride = {
      id: 'o1',
      planId: 'p1',
      date: '2026-09-03',
      status: 'done',
      actualStart: callerAt,
      actualEnd: callerAt,
      startMinute: null,
      durationMinutes: null,
      updatedAt: callerAt,
    };

    await saveProject(testProject);
    await savePlan(testPlan);
    await saveOverride(testOverride);

    const storedProject = (
      JSON.parse(localStorage.getItem('nowline.projects.v2')!) as Project[]
    ).find((row) => row.id === 'health');
    const storedPlan = (
      JSON.parse(localStorage.getItem('nowline.plans.v2')!) as BlockPlan[]
    ).find((row) => row.id === 'p1');
    const storedOverride = (
      JSON.parse(localStorage.getItem('nowline.overrides.v2')!) as BlockOverride[]
    ).find((row) => row.id === 'o1');

    const memoryProject = getState().projects.find((row) => row.id === 'health');
    const memoryPlan = getState().plans.find((row) => row.id === 'p1');
    const memoryOverride = getState().overrides.find((row) => row.id === 'o1');

    expect(storedProject?.updatedAt).toBe(stampedAt);
    expect(memoryProject).toEqual(storedProject);
    expect(memoryPlan).toEqual(storedPlan);
    expect(memoryOverride).toEqual(storedOverride);
  });
});
