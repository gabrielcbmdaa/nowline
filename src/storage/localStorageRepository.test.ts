// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockOverride, BlockPlan, Project } from '../domain/types';
import { LocalStorageRepository } from './localStorageRepository';

const FROZEN = '2026-09-07T10:00:00.000Z';
const frozenClock = () => new Date(FROZEN);

const project: Project = {
  id: 'health',
  name: 'Health',
  color: '#E5484D',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  deletedAt: null,
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
  updatedAt: '2026-09-03T00:00:00.000Z',
  deletedAt: null,
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
    updatedAt: `${date}T06:00:00.000Z`,
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
    const [stored] = await repo.listProjects();
    expect(stored).toEqual({ ...project, updatedAt: expect.any(String) });

    await repo.saveProject({ ...project, name: 'Fitness' });
    const projects = await repo.listProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Fitness');
  });

  it('survives a page reload', async () => {
    await repo.saveProject(project);
    const reopened = new LocalStorageRepository();
    const [reloaded] = await reopened.listProjects();
    expect(reloaded).toEqual({ ...project, updatedAt: expect.any(String) });
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
    // The live v2 key, not the legacy one: this covers the read path every save and
    // load goes through, not the one-time migration's copy of legacy rows.
    localStorage.setItem('nowline.projects.v2', 'not json at all');

    expect(await new LocalStorageRepository().listProjects()).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();

    warn.mockRestore();
  });

  it('drops a null entry instead of returning it', async () => {
    localStorage.setItem('nowline.projects.v2', '[null]');
    expect(await new LocalStorageRepository().listProjects()).toEqual([]);
  });

  it('drops a string entry instead of returning it', async () => {
    localStorage.setItem('nowline.projects.v2', '["not an object"]');
    expect(await new LocalStorageRepository().listProjects()).toEqual([]);
  });

  it('drops a legacy row with no id during migration, instead of stranding it', async () => {
    localStorage.setItem('tt.projects.v1', JSON.stringify([{ name: 'Health' }]));
    expect(await new LocalStorageRepository().listProjects()).toEqual([]);
  });

  it('stamps updatedAt itself, ignoring whatever the caller passed', async () => {
    const stamped = new LocalStorageRepository(frozenClock);

    await stamped.saveProject({ ...project, updatedAt: '1999-01-01T00:00:00.000Z' });

    const [stored] = await stamped.listProjects();
    expect(stored.updatedAt).toBe(FROZEN);
  });

  it('migrates the v1 keys into the v2 keys and leaves v1 untouched', async () => {
    const legacyProject = {
      id: 'health',
      name: 'Health',
      color: '#E5484D',
      createdAt: '2026-09-01T00:00:00.000Z',
    };
    localStorage.setItem('tt.projects.v1', JSON.stringify([legacyProject]));

    const migrated = new LocalStorageRepository(frozenClock);
    const projects = await migrated.listProjects();

    expect(projects).toEqual([
      { ...legacyProject, updatedAt: FROZEN, deletedAt: null },
    ]);
    expect(JSON.parse(localStorage.getItem('tt.projects.v1') ?? '[]')).toEqual([
      legacyProject,
    ]);
  });

  it('migrates before a first write, so no v1 row is stranded', async () => {
    localStorage.setItem('tt.plans.v1', JSON.stringify([{ ...plan, id: 'old' }]));

    const migrated = new LocalStorageRepository(frozenClock);
    await migrated.savePlan({ ...plan, id: 'new' });

    const ids = (await migrated.listPlans()).map((row) => row.id);
    expect(ids).toEqual(['old', 'new']);
  });

  it('does not migrate a second time once the v2 key exists', async () => {
    localStorage.setItem('nowline.projects.v2', JSON.stringify([]));
    localStorage.setItem('tt.projects.v1', JSON.stringify([project]));

    const migrated = new LocalStorageRepository(frozenClock);

    expect(await migrated.listProjects()).toEqual([]);
  });
});
