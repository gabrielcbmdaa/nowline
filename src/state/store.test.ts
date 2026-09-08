// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockOverride, BlockPlan, Project } from '../domain/types';
import { repository } from '../storage/repository';
import {
  deletePlan,
  deleteProject,
  getState,
  loadAll,
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

  it('reloads after deleting a plan, so the buried plan keeps its delete-time stamp in memory', async () => {
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

    // A hand-patched copy dropped the plan from memory outright; a reload keeps
    // the buried row (filtering it out of the list is a later task) with its own
    // fresh stamp, which only the repository's delete-time write can supply.
    const deletedAt = new Date(2026, 8, 3, 10, 0, 0).toISOString();
    vi.setSystemTime(new Date(2026, 8, 3, 10, 0, 0));
    await deletePlan('p1');

    const plan = getState().plans.find((row) => row.id === 'p1');
    expect(plan?.deletedAt).toBe(deletedAt);
    expect(plan?.updatedAt).toBe(deletedAt);
    expect(getState().overrides).toEqual([]);
  });
});
