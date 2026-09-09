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

function throwWhenWriting(keyToThrow: string) {
  const original = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === keyToThrow) throw new Error('quota exceeded');
    return original.call(this, key, value);
  });
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

    // The project is buried and filtered out by listProjects. The plan that lost
    // its project is NOT deleted (only unassigned), so it stays in listPlans.
    const projects = await repo.listProjects();
    expect(projects).toEqual([]);

    const plans = await repo.listPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe('p1');
    expect(plans[0].projectId).toBeNull();
    expect(plans[0].deletedAt).toBeNull();

    // Verify the project is still in storage with deletedAt set: buried, not removed.
    const rawProjects = JSON.parse(localStorage.getItem('nowline.projects.v2') ?? '[]');
    expect(rawProjects).toHaveLength(1);
    expect(rawProjects[0].id).toBe('health');
    expect(rawProjects[0].deletedAt).not.toBeNull();
  });

  it('removes the overrides of a deleted plan', async () => {
    await repo.savePlan(plan);
    await repo.saveOverride(override('2026-09-03'));
    await repo.deletePlan('p1');

    // The plan is buried and filtered out by listPlans. Its overrides are removed outright.
    expect(await repo.listPlans()).toEqual([]);
    expect(await repo.listOverrides()).toEqual([]);

    // Verify the plan is still in raw storage with deletedAt set.
    const rawPlans = JSON.parse(localStorage.getItem('nowline.plans.v2') ?? '[]');
    expect(rawPlans).toHaveLength(1);
    expect(rawPlans[0].deletedAt).not.toBeNull();
  });

  it('marks a plan as deleted instead of removing the row', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.savePlan(plan);

    await repoAt.deletePlan('p1');

    const raw = JSON.parse(localStorage.getItem('nowline.plans.v2') ?? '[]');
    expect(raw).toHaveLength(1);
    expect(raw[0].deletedAt).toBe(FROZEN);
  });

  it('bumps updatedAt on every plan that loses its project', async () => {
    // Two different clocks, on purpose: with one frozen clock the save and the
    // delete would land on the same instant, and the assertion below could pass
    // whether or not the cascade actually rewrites updatedAt.
    const savedAt = '2026-09-06T10:00:00.000Z';
    const repoWhenSaved = new LocalStorageRepository(() => new Date(savedAt));
    const repoWhenDeleted = new LocalStorageRepository(frozenClock);

    await repoWhenSaved.saveProject(project);
    await repoWhenSaved.savePlan(plan);

    await repoWhenDeleted.deleteProject('health');

    const raw = JSON.parse(localStorage.getItem('nowline.plans.v2') ?? '[]');
    expect(raw[0].projectId).toBeNull();
    expect(raw[0].updatedAt).not.toBe(savedAt);
    expect(raw[0].updatedAt).toBe(FROZEN);
  });

  it('still drops the overrides of a deleted plan, since the plan carries the news', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));

    await repoAt.deletePlan('p1');

    expect(JSON.parse(localStorage.getItem('nowline.overrides.v2') ?? '[]')).toEqual([]);
  });

  it('hides buried rows from the lists the app reads', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);

    await repoAt.deleteProject('health');
    await repoAt.deletePlan('p1');

    expect(await repoAt.listProjects()).toEqual([]);
    expect(await repoAt.listPlans()).toEqual([]);
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

  it('migrates an override without adding a deletedAt key', async () => {
    const legacyOverride = {
      id: 'o1',
      planId: 'p1',
      date: '2026-09-03',
      status: 'done',
      actualStart: '2026-09-03T05:00:00.000Z',
      actualEnd: '2026-09-03T06:00:00.000Z',
      startMinute: null,
      durationMinutes: null,
    };
    localStorage.setItem('tt.overrides.v1', JSON.stringify([legacyOverride]));

    const migrated = new LocalStorageRepository(frozenClock);
    await migrated.listOverrides();

    const stored = JSON.parse(localStorage.getItem('nowline.overrides.v2') ?? '[]')[0] as Record<
      string,
      unknown
    >;
    expect(stored).toEqual({ ...legacyOverride, updatedAt: FROZEN });
    expect(Object.prototype.hasOwnProperty.call(stored, 'deletedAt')).toBe(false);
  });

  it('strips a deletedAt key from a legacy override during migration', async () => {
    const legacyOverride = {
      id: 'o1',
      planId: 'p1',
      date: '2026-09-03',
      status: 'done',
      actualStart: '2026-09-03T05:00:00.000Z',
      actualEnd: '2026-09-03T06:00:00.000Z',
      startMinute: null,
      durationMinutes: null,
      deletedAt: '2026-09-01T00:00:00.000Z',
    };
    localStorage.setItem('tt.overrides.v1', JSON.stringify([legacyOverride]));

    const migrated = new LocalStorageRepository(frozenClock);
    await migrated.listOverrides();

    const stored = JSON.parse(localStorage.getItem('nowline.overrides.v2') ?? '[]')[0] as Record<
      string,
      unknown
    >;
    expect('deletedAt' in stored).toBe(false);
    expect(stored).toEqual({
      id: 'o1',
      planId: 'p1',
      date: '2026-09-03',
      status: 'done',
      actualStart: '2026-09-03T05:00:00.000Z',
      actualEnd: '2026-09-03T06:00:00.000Z',
      startMinute: null,
      durationMinutes: null,
      updatedAt: FROZEN,
    });
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

  it('remembers which rows this device still owes the server', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);

    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));

    expect(await repoAt.listPending()).toEqual({
      projects: [],
      plans: ['p1'],
      overrides: ['o-2026-09-03'],
    });
  });

  it('remembers a project this device still owes the server', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);

    await repoAt.saveProject(project);

    expect((await repoAt.listPending()).projects).toEqual(['health']);
  });

  it('queues every plan that loses its project', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);
    await repoAt.savePlan({ ...plan, id: 'p2' });

    await repoAt.clearPending({
      projects: ['health'],
      plans: ['p1', 'p2'],
      overrides: [],
    });

    await repoAt.deleteProject('health');

    const pending = await repoAt.listPending();
    expect(pending.projects).toEqual(['health']);
    expect(pending.plans).toEqual(['p1', 'p2']);
  });

  it('forgets a row once it has been sent', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.savePlan(plan);

    await repoAt.clearPending({ projects: [], plans: ['p1'], overrides: [] });

    expect((await repoAt.listPending()).plans).toEqual([]);
  });

  it('drops an override from the queue when its plan is deleted', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));

    await repoAt.deletePlan('p1');

    const pending = await repoAt.listPending();
    expect(pending.plans).toEqual(['p1']);
    expect(pending.overrides).toEqual([]);
  });

  it('drops an override from the queue when the override itself is deleted', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));

    await repoAt.deleteOverride('o-2026-09-03');

    const pending = await repoAt.listPending();
    expect(pending.plans).toEqual(['p1']);
    expect(pending.overrides).toEqual([]);
  });

  it('hands back independent pending arrays so a caller cannot poison later reads', async () => {
    const first = await repo.listPending();
    first.plans.push('ghost');

    expect((await repo.listPending()).plans).toEqual([]);
  });

  it('treats a corrupt queue as every stored row still being owed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));
    await repoAt.deleteProject('health');

    localStorage.setItem('nowline.pending.v1', 'not json at all');

    expect(await repoAt.listPending()).toEqual({
      projects: ['health'],
      plans: ['p1'],
      overrides: ['o-2026-09-03'],
    });

    localStorage.setItem('nowline.pending.v1', 'null');

    expect(await repoAt.listPending()).toEqual({
      projects: ['health'],
      plans: ['p1'],
      overrides: ['o-2026-09-03'],
    });

    warn.mockRestore();
  });

  it('treats a missing queue as nothing pending, even when rows exist', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));

    localStorage.removeItem('nowline.pending.v1');

    expect(await repoAt.listPending()).toEqual({
      projects: [],
      plans: [],
      overrides: [],
    });
  });

  it('treats an empty-string queue as every stored row still being owed, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));

    localStorage.setItem('nowline.pending.v1', '');

    expect(await repoAt.listPending()).toEqual({
      projects: ['health'],
      plans: ['p1'],
      overrides: ['o-2026-09-03'],
    });
    expect(warn).toHaveBeenCalled();
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('nowline.pending.v1');
    expect(message).toContain('treating every stored row as owed');

    warn.mockRestore();
  });

  it('treats a queue whose kinds are not all arrays as every stored row still being owed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));

    localStorage.setItem('nowline.pending.v1', JSON.stringify({ projects: 'oops' }));

    expect(await repoAt.listPending()).toEqual({
      projects: ['health'],
      plans: ['p1'],
      overrides: ['o-2026-09-03'],
    });

    warn.mockRestore();
  });

  it('treats a queue holding a non-string id as every stored row still being owed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));

    localStorage.setItem(
      'nowline.pending.v1',
      JSON.stringify({ projects: [], plans: [7], overrides: [] }),
    );

    expect(await repoAt.listPending()).toEqual({
      projects: ['health'],
      plans: ['p1'],
      overrides: ['o-2026-09-03'],
    });
    expect(warn).toHaveBeenCalled();
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('nowline.pending.v1');
    expect(message).toContain('treating every stored row as owed');

    warn.mockRestore();
  });

  it('treats a JSON array stored as the queue as every stored row still being owed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));

    localStorage.setItem('nowline.pending.v1', '[]');

    expect(await repoAt.listPending()).toEqual({
      projects: ['health'],
      plans: ['p1'],
      overrides: ['o-2026-09-03'],
    });

    warn.mockRestore();
  });

  it('keeps a queue that legitimately holds empty arrays', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);

    localStorage.setItem(
      'nowline.pending.v1',
      JSON.stringify({ projects: [], plans: ['p1'], overrides: [] }),
    );

    expect(await repoAt.listPending()).toEqual({
      projects: [],
      plans: ['p1'],
      overrides: [],
    });
  });

  it('warns when recovering a corrupt queue, naming the damage and the repair', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);

    const shapes = [
      'null',
      '[]',
      JSON.stringify({ projects: 'oops' }),
      'not json at all',
    ];

    for (const raw of shapes) {
      warn.mockClear();
      localStorage.setItem('nowline.pending.v1', raw);
      await repoAt.listPending();
      expect(warn).toHaveBeenCalled();
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain('nowline.pending.v1');
      expect(message).toContain('treating every stored row as owed');
    }

    warn.mockRestore();
  });

  it('does not warn when the queue is missing or holds empty arrays', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);

    localStorage.removeItem('nowline.pending.v1');
    await repoAt.listPending();
    expect(warn).not.toHaveBeenCalled();

    localStorage.setItem(
      'nowline.pending.v1',
      JSON.stringify({ projects: [], plans: ['p1'], overrides: [] }),
    );
    await repoAt.listPending();
    expect(warn).not.toHaveBeenCalled();

    warn.mockRestore();
  });

  it('hands over a deleted row so the deletion can travel', async () => {
    const repo = new LocalStorageRepository();
    await repo.savePlan({ ...plan, id: 'p1' });
    await repo.deletePlan('p1');

    const rows = await repo.rowsToUpload(await repo.listPending());

    // listPlans() hides this row on purpose. The server has to hear about it,
    // or the other device hands the block straight back.
    expect(rows.plans.map((row) => row.id)).toEqual(['p1']);
    expect(rows.plans[0].deletedAt).not.toBeNull();
  });

  it('hands over only what is owed, not the whole store', async () => {
    const repo = new LocalStorageRepository();
    await repo.savePlan({ ...plan, id: 'p1' });
    await repo.savePlan({ ...plan, id: 'p2' });
    await repo.clearPending({ projects: [], plans: ['p1'], overrides: [] });

    const rows = await repo.rowsToUpload(await repo.listPending());
    expect(rows.plans.map((row) => row.id)).toEqual(['p2']);
  });

  it('skips an id whose row is no longer there', async () => {
    const repo = new LocalStorageRepository();

    // A queue can outlive its row: cleared storage, a migration that dropped a
    // corrupt row. Uploading `undefined` would be worse than uploading nothing.
    const rows = await repo.rowsToUpload({ projects: [], plans: ['ghost'], overrides: [] });
    expect(rows.plans).toEqual([]);
  });

  it('rewrites a recovered queue on the next save, so later reads see the healed key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));

    localStorage.setItem('nowline.pending.v1', 'not json at all');

    await repoAt.saveProject({ ...project, id: 'work', name: 'Work' });

    expect(JSON.parse(localStorage.getItem('nowline.pending.v1') ?? '')).toEqual({
      projects: ['health', 'work'],
      plans: ['p1'],
      overrides: ['o-2026-09-03'],
    });

    warn.mockRestore();
  });

  it('still queues a saved project when the row write is the one that fills storage', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.listProjects();

    const original = Storage.prototype.setItem;
    let writes = 0;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      writes += 1;
      if (writes === 2) throw new Error('quota exceeded');
      return original.call(this, key, value);
    });

    try {
      await expect(repoAt.saveProject(project)).rejects.toThrow('quota exceeded');
      const pending = JSON.parse(localStorage.getItem('nowline.pending.v1') ?? 'null') as {
        projects?: string[];
      } | null;
      expect(pending?.projects).toEqual(['health']);
    } finally {
      spy.mockRestore();
    }
  });

  it('still queues a saved plan when the row write is the one that fills storage', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.listPlans();

    const spy = throwWhenWriting('nowline.plans.v2');
    try {
      await expect(repoAt.savePlan(plan)).rejects.toThrow('quota exceeded');
      const pending = JSON.parse(localStorage.getItem('nowline.pending.v1') ?? 'null') as {
        plans?: string[];
      } | null;
      expect(pending?.plans).toEqual(['p1']);
    } finally {
      spy.mockRestore();
    }
  });

  it('still queues a saved override when the row write is the one that fills storage', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.listOverrides();

    const spy = throwWhenWriting('nowline.overrides.v2');
    try {
      await expect(repoAt.saveOverride(override('2026-09-03'))).rejects.toThrow('quota exceeded');
      const pending = JSON.parse(localStorage.getItem('nowline.pending.v1') ?? 'null') as {
        overrides?: string[];
      } | null;
      expect(pending?.overrides).toEqual(['o-2026-09-03']);
    } finally {
      spy.mockRestore();
    }
  });

  // Pins the whole cascade, not only the project id: a refactor that marks the
  // project, writes, then marks plans would still queue 'health' when the project
  // write throws, and would stay green if this test only looked at projects.
  it('still queues a deleted project and its unassigned plans when a row write fills storage', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveProject(project);
    await repoAt.savePlan(plan);
    await repoAt.savePlan({ ...plan, id: 'p2' });
    await repoAt.clearPending({
      projects: ['health'],
      plans: ['p1', 'p2'],
      overrides: [],
    });

    const spy = throwWhenWriting('nowline.projects.v2');
    try {
      await expect(repoAt.deleteProject('health')).rejects.toThrow('quota exceeded');
      const pending = JSON.parse(localStorage.getItem('nowline.pending.v1') ?? 'null') as {
        projects?: string[];
        plans?: string[];
      } | null;
      expect(pending?.projects).toEqual(['health']);
      expect(pending?.plans).toEqual(['p1', 'p2']);
    } finally {
      spy.mockRestore();
    }
  });

  it('still queues a deleted plan when the row write is the one that fills storage', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));
    await repoAt.clearPending({
      projects: [],
      plans: ['p1'],
      overrides: ['o-2026-09-03'],
    });

    const spy = throwWhenWriting('nowline.plans.v2');
    try {
      await expect(repoAt.deletePlan('p1')).rejects.toThrow('quota exceeded');
      const pending = JSON.parse(localStorage.getItem('nowline.pending.v1') ?? 'null') as {
        plans?: string[];
      } | null;
      expect(pending?.plans).toEqual(['p1']);
    } finally {
      spy.mockRestore();
    }
  });

  it('still drops a deleted override from storage when the queue write is the one that fills storage', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.saveOverride(override('2026-09-03'));

    const spy = throwWhenWriting('nowline.pending.v1');
    try {
      await expect(repoAt.deleteOverride('o-2026-09-03')).rejects.toThrow('quota exceeded');
      expect(JSON.parse(localStorage.getItem('nowline.overrides.v2') ?? '[]')).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  it('starts with no token and no cursor', async () => {
    const repo = new LocalStorageRepository();
    expect(await repo.readSyncState()).toEqual({ token: null, cursor: null });
  });

  it('keeps the token and the cursor across instances', async () => {
    await new LocalStorageRepository().writeSyncState({ token: 'abc', cursor: '2026-09-09T20:00:00.000Z' });

    const later = new LocalStorageRepository();
    expect(await later.readSyncState()).toEqual({ token: 'abc', cursor: '2026-09-09T20:00:00.000Z' });
  });

  it('treats a damaged sync state as never having synced', async () => {
    localStorage.setItem('nowline.sync.v1', 'not json at all');

    // Forgetting the cursor costs one full download. Trusting a damaged one
    // costs rows that are never asked for again.
    expect(await new LocalStorageRepository().readSyncState()).toEqual({ token: null, cursor: null });
  });

  it('keeps the token when only the cursor is damaged', async () => {
    localStorage.setItem('nowline.sync.v1', JSON.stringify({ token: 'abc', cursor: 42 }));

    // Losing the token means the owner types a password again for nothing.
    expect(await new LocalStorageRepository().readSyncState()).toEqual({ token: 'abc', cursor: null });
  });

  it('keeps an id in the queue when the row changed while it was in flight', async () => {
    // Two clocks, on purpose: two saves in one millisecond share an updatedAt,
    // and the race this test pins is a stamp that moved between read and confirm.
    const versionAAt = '2026-09-06T10:00:00.000Z';
    const versionBAt = '2026-09-07T10:00:00.000Z';
    const repo = new LocalStorageRepository(() => new Date(versionAAt));
    await repo.savePlan({ ...plan, id: 'p1', title: 'version A' });

    // What the upload loop sent, read before the request went out.
    const sent = await repo.rowsToUpload(await repo.listPending());
    const asSent = { id: 'p1', updatedAt: sent.plans[0].updatedAt as string };

    // The owner edits while the request is in the air. markPending changes
    // nothing: p1 is already queued.
    const repoAfterEdit = new LocalStorageRepository(() => new Date(versionBAt));
    await repoAfterEdit.savePlan({ ...plan, id: 'p1', title: 'version B' });

    await repoAfterEdit.clearPendingUnchanged({ projects: [], plans: [asSent], overrides: [] });

    // Version B is still owed. Clearing by id alone would lose it silently.
    expect((await repoAfterEdit.listPending()).plans).toEqual(['p1']);
  });

  it('drops an id whose row is untouched since it was sent', async () => {
    const repo = new LocalStorageRepository();
    await repo.savePlan({ ...plan, id: 'p1' });
    const sent = await repo.rowsToUpload(await repo.listPending());

    await repo.clearPendingUnchanged({
      projects: [],
      plans: [{ id: 'p1', updatedAt: sent.plans[0].updatedAt as string }],
      overrides: [],
    });

    expect((await repo.listPending()).plans).toEqual([]);
  });

  it('leaves alone an id it was not told about', async () => {
    const repo = new LocalStorageRepository();
    await repo.savePlan({ ...plan, id: 'p1' });
    await repo.savePlan({ ...plan, id: 'p2' });
    const sent = await repo.rowsToUpload(await repo.listPending());
    const p1 = sent.plans.find((row) => row.id === 'p1');

    await repo.clearPendingUnchanged({
      projects: [],
      plans: [{ id: 'p1', updatedAt: p1?.updatedAt as string }],
      overrides: [],
    });

    expect((await repo.listPending()).plans).toEqual(['p2']);
  });

  it('writes a downloaded row without stamping it or queueing it', async () => {
    const repo = new LocalStorageRepository();

    await repo.applyFromServer({
      projects: [],
      plans: [{ ...{ ...plan, id: 'p1', title: 'from the other device' }, updatedAt: '2026-01-01T00:00:00.000Z' }],
      overrides: [],
    });

    const stored = JSON.parse(localStorage.getItem('nowline.plans.v2') ?? '[]');
    // The stamp is the other device's, kept exactly: it is what decides who
    // wins next time. Re-stamping here would make this device look newer than
    // it is, and the two would hand the same row back and forth for ever.
    expect(stored[0].updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect((await repo.listPending()).plans).toEqual([]);
  });

  it('keeps the local copy when it carries the newer stamp', async () => {
    const repo = new LocalStorageRepository();
    await repo.savePlan({ ...plan, id: 'p1', title: 'mine, edited just now' });

    await repo.applyFromServer({
      projects: [],
      plans: [{ ...{ ...plan, id: 'p1', title: 'older, from the server' }, updatedAt: '2020-01-01T00:00:00.000Z' }],
      overrides: [],
    });

    const plans = await repo.listPlans();
    expect(plans[0].title).toBe('mine, edited just now');
  });

  it('lets a downloaded tombstone bury a row this device still shows', async () => {
    const repo = new LocalStorageRepository();
    await repo.savePlan({ ...plan, id: 'p1' });

    await repo.applyFromServer({
      projects: [],
      plans: [{ ...{ ...plan, id: 'p1' }, deletedAt: '2099-01-01T00:00:00.000Z', updatedAt: '2099-01-01T00:00:00.000Z' }],
      overrides: [],
    });

    // Not `listPlans()` alone: an empty list is also what a row deleted outright
    // looks like, so that assertion cannot tell burying from removing. The row
    // has to still be there, carrying its tombstone — it is what this device
    // will hand the next device that asks.
    const stored = JSON.parse(localStorage.getItem('nowline.plans.v2') ?? '[]');
    expect(stored.map((row: { id: string; deletedAt: string | null }) => [row.id, row.deletedAt])).toEqual([
      ['p1', '2099-01-01T00:00:00.000Z'],
    ]);
    expect(await repo.listPlans()).toEqual([]);
  });

  it('keeps a copy of everything local before anything is discarded', async () => {
    await repo.saveProject({ ...project, id: 'pr1' });
    await repo.savePlan({ ...plan, id: 'p1' });
    await repo.saveOverride(override('2026-09-03'));

    await repo.keepDiscardedCopy('2026-09-09');

    const saved = JSON.parse(localStorage.getItem('nowline.discarded.2026-09-09') ?? 'null');
    // Nothing is destroyed. Same idea as keeping the tt.*.v1 keys: the owner's
    // real data lives on a phone, where there is no console to dig it out of.
    expect(saved.projects[0].id).toBe('pr1');
    expect(saved.plans[0].id).toBe('p1');
    expect(saved.overrides[0].id).toBe('o-2026-09-03');
  });

  it('still drops a deleted plan\'s overrides from storage when the queue write is the one that fills storage', async () => {
    const repoAt = new LocalStorageRepository(frozenClock);
    await repoAt.savePlan(plan);
    await repoAt.saveOverride(override('2026-09-03'));
    await repoAt.clearPending({
      projects: [],
      plans: ['p1'],
      overrides: ['o-2026-09-03'],
    });

    // deletePlan marks the plan pending before it drops overrides, so a blanket
    // throwWhenWriting on the queue key would fire too early. Pin the unmark step.
    const original = Storage.prototype.setItem;
    let pendingWrites = 0;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'nowline.pending.v1') {
        pendingWrites += 1;
        if (pendingWrites === 2) throw new Error('quota exceeded');
      }
      return original.call(this, key, value);
    });

    try {
      await expect(repoAt.deletePlan('p1')).rejects.toThrow('quota exceeded');
      expect(JSON.parse(localStorage.getItem('nowline.overrides.v2') ?? '[]')).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});
