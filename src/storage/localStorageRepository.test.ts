// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockOverride, BlockPlan, Project } from '../domain/types';
import { LocalStorageRepository } from './localStorageRepository';

const project: Project = {
  id: 'health',
  name: 'Health',
  color: '#E5484D',
  createdAt: '2026-09-01T00:00:00.000Z',
};

const plan: BlockPlan = {
  id: 'p1',
  title: 'Make exercise',
  projectId: 'health',
  startMinute: 300,
  durationMinutes: 120,
  recurrence: { type: 'daily' },
  anchorDate: '2026-09-03',
  endDate: null,
  createdAt: '2026-09-03T00:00:00.000Z',
};

function override(date: string): BlockOverride {
  return {
    id: `o-${date}`,
    planId: 'p1',
    date,
    status: 'done',
    actualStart: `${date}T05:00:00.000Z`,
    actualEnd: `${date}T06:00:00.000Z`,
    startMinute: null,
    durationMinutes: null,
  };
}

describe('LocalStorageRepository', () => {
  let repo: LocalStorageRepository;

  beforeEach(() => {
    localStorage.clear();
    repo = new LocalStorageRepository();
  });

  it('starts empty', async () => {
    expect(await repo.listProjects()).toEqual([]);
    expect(await repo.listPlans()).toEqual([]);
    expect(await repo.listOverrides()).toEqual([]);
  });

  it('saves and reads back a project, and updates it in place', async () => {
    await repo.saveProject(project);
    expect(await repo.listProjects()).toEqual([project]);

    await repo.saveProject({ ...project, name: 'Fitness' });
    const projects = await repo.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Fitness');
  });

  it('survives a page reload', async () => {
    await repo.saveProject(project);
    const reopened = new LocalStorageRepository();
    expect(await reopened.listProjects()).toEqual([project]);
  });

  it('unassigns the blocks of a deleted project instead of losing them', async () => {
    await repo.saveProject(project);
    await repo.savePlan(plan);
    await repo.deleteProject('health');

    expect(await repo.listProjects()).toEqual([]);
    const plans = await repo.listPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].projectId).toBeNull();
  });

  it('removes the overrides of a deleted plan', async () => {
    await repo.savePlan(plan);
    await repo.saveOverride(override('2026-09-03'));
    await repo.deletePlan('p1');

    expect(await repo.listPlans()).toEqual([]);
    expect(await repo.listOverrides()).toEqual([]);
  });

  it('filters overrides by date range', async () => {
    await repo.saveOverride(override('2026-09-01'));
    await repo.saveOverride(override('2026-09-03'));
    await repo.saveOverride(override('2026-09-05'));

    const inRange = await repo.listOverrides('2026-09-02', '2026-09-04');
    expect(inRange.map((o) => o.date)).toEqual(['2026-09-03']);
    expect(await repo.listOverrides()).toHaveLength(3);
  });

  it('recovers from corrupt storage instead of crashing, and says so', async () => {
    // Silenced on purpose: the warning is the point of the test, not noise from it.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('tt.projects.v1', 'not json at all');

    expect(await new LocalStorageRepository().listProjects()).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
  });

  it('drops a null entry instead of returning it', async () => {
    localStorage.setItem('tt.projects.v1', '[null]');
    expect(await new LocalStorageRepository().listProjects()).toEqual([]);
  });

  it('drops a string entry instead of returning it', async () => {
    localStorage.setItem('tt.projects.v1', '["not an object"]');
    expect(await new LocalStorageRepository().listProjects()).toEqual([]);
  });

  it('drops a row with no id', async () => {
    localStorage.setItem('tt.projects.v1', JSON.stringify([{ name: 'Health' }]));
    expect(await new LocalStorageRepository().listProjects()).toEqual([]);
  });
});
