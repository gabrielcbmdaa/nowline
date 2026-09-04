import { describe, expect, it } from 'vitest';
import type { BlockOverride, BlockPlan, Project } from './types';
import { indexOverrides, occurrencesForDay, planAppliesOn } from './recurrence';

const project: Project = {
  id: 'health',
  name: 'Health',
  color: '#E5484D',
  createdAt: '2026-09-01T00:00:00.000Z',
};

const projectsById = new Map([[project.id, project]]);

const dailyPlan: BlockPlan = {
  id: 'p1',
  title: 'Make exercise',
  projectId: 'health',
  startMinute: 300, // 5:00
  durationMinutes: 120,
  recurrence: { type: 'daily' },
  anchorDate: '2026-09-03',
  endDate: null,
  createdAt: '2026-09-03T00:00:00.000Z',
};

describe('planAppliesOn', () => {
  it('shows a one-off plan only on its anchor day', () => {
    const oneOff: BlockPlan = { ...dailyPlan, recurrence: { type: 'none' } };
    expect(planAppliesOn(oneOff, '2026-09-03')).toBe(true);
    expect(planAppliesOn(oneOff, '2026-09-04')).toBe(false);
  });

  it('never shows a plan before its anchor day', () => {
    expect(planAppliesOn(dailyPlan, '2026-09-02')).toBe(false);
    expect(planAppliesOn(dailyPlan, '2026-09-03')).toBe(true);
  });

  it('stops a plan after its end date', () => {
    const bounded: BlockPlan = { ...dailyPlan, endDate: '2026-09-05' };
    expect(planAppliesOn(bounded, '2026-09-05')).toBe(true);
    expect(planAppliesOn(bounded, '2026-09-06')).toBe(false);
  });

  it('shows a weekly plan only on its weekdays', () => {
    const mondays: BlockPlan = {
      ...dailyPlan,
      recurrence: { type: 'weekly', weekdays: [1] },
    };
    expect(planAppliesOn(mondays, '2026-09-07')).toBe(true); // Monday
    expect(planAppliesOn(mondays, '2026-09-08')).toBe(false); // Tuesday
    expect(planAppliesOn(mondays, '2026-09-14')).toBe(true); // Monday
  });
});

describe('occurrencesForDay', () => {
  const now = new Date(2026, 8, 3, 12, 0, 0);

  it('draws a scheduled block at its planned time with its project colour', () => {
    const [occurrence] = occurrencesForDay(
      [dailyPlan],
      indexOverrides([]),
      projectsById,
      '2026-09-03',
      now,
    );
    expect(occurrence.status).toBe('scheduled');
    expect(occurrence.project?.color).toBe('#E5484D');
    expect(occurrence.displayStart.getHours()).toBe(5);
    expect(occurrence.displayEnd.getHours()).toBe(7);
  });

  it('moves the block to the real start once it is running, and grows past the plan', () => {
    const running: BlockOverride = {
      id: 'o1',
      planId: 'p1',
      date: '2026-09-03',
      status: 'running',
      actualStart: new Date(2026, 8, 3, 5, 31, 12).toISOString(),
      actualEnd: null,
      startMinute: null,
      durationMinutes: null,
    };

    const early = occurrencesForDay(
      [dailyPlan],
      indexOverrides([running]),
      projectsById,
      '2026-09-03',
      new Date(2026, 8, 3, 6, 0, 0),
    )[0];
    expect(early.status).toBe('running');
    expect(early.displayStart.getMinutes()).toBe(31);
    // Still the planned two hours while inside them.
    expect(early.displayEnd.getTime()).toBe(new Date(2026, 8, 3, 7, 31, 12).getTime());

    const late = occurrencesForDay(
      [dailyPlan],
      indexOverrides([running]),
      projectsById,
      '2026-09-03',
      new Date(2026, 8, 3, 9, 0, 0),
    )[0];
    // Past the planned end it follows the clock.
    expect(late.displayEnd.getTime()).toBe(new Date(2026, 8, 3, 9, 0, 0).getTime());
  });

  it('shrinks a stopped block to the real time', () => {
    const done: BlockOverride = {
      id: 'o1',
      planId: 'p1',
      date: '2026-09-03',
      status: 'done',
      actualStart: new Date(2026, 8, 3, 5, 31, 12).toISOString(),
      actualEnd: new Date(2026, 8, 3, 6, 17, 40).toISOString(),
      startMinute: null,
      durationMinutes: null,
    };
    const occurrence = occurrencesForDay(
      [dailyPlan],
      indexOverrides([done]),
      projectsById,
      '2026-09-03',
      now,
    )[0];
    expect(occurrence.status).toBe('done');
    expect(occurrence.displayEnd.getTime()).toBe(new Date(2026, 8, 3, 6, 17, 40).getTime());
  });

  it('leaves the following days untouched by one day of tracking', () => {
    const done: BlockOverride = {
      id: 'o1',
      planId: 'p1',
      date: '2026-09-03',
      status: 'done',
      actualStart: new Date(2026, 8, 3, 5, 31, 12).toISOString(),
      actualEnd: new Date(2026, 8, 3, 6, 17, 40).toISOString(),
      startMinute: null,
      durationMinutes: null,
    };
    const tomorrow = occurrencesForDay(
      [dailyPlan],
      indexOverrides([done]),
      projectsById,
      '2026-09-04',
      now,
    )[0];
    expect(tomorrow.status).toBe('scheduled');
    expect(tomorrow.displayStart.getHours()).toBe(5);
    expect(tomorrow.displayStart.getMinutes()).toBe(0);
  });

  it('hides a single day deleted by an override', () => {
    const deleted: BlockOverride = {
      id: 'o1',
      planId: 'p1',
      date: '2026-09-03',
      status: 'deleted',
      actualStart: null,
      actualEnd: null,
      startMinute: null,
      durationMinutes: null,
    };
    expect(
      occurrencesForDay([dailyPlan], indexOverrides([deleted]), projectsById, '2026-09-03', now),
    ).toHaveLength(0);
    expect(
      occurrencesForDay([dailyPlan], indexOverrides([deleted]), projectsById, '2026-09-04', now),
    ).toHaveLength(1);
  });

  it('honours a per-day reschedule without touching the plan', () => {
    const moved: BlockOverride = {
      id: 'o1',
      planId: 'p1',
      date: '2026-09-03',
      status: 'scheduled',
      actualStart: null,
      actualEnd: null,
      startMinute: 420, // 7:00
      durationMinutes: 60,
    };
    const occurrence = occurrencesForDay(
      [dailyPlan],
      indexOverrides([moved]),
      projectsById,
      '2026-09-03',
      now,
    )[0];
    expect(occurrence.displayStart.getHours()).toBe(7);
    expect(occurrence.displayEnd.getHours()).toBe(8);
  });

  it('sorts the day by start time', () => {
    const later: BlockPlan = { ...dailyPlan, id: 'p2', title: 'Read', startMinute: 600 };
    const occurrences = occurrencesForDay(
      [later, dailyPlan],
      indexOverrides([]),
      projectsById,
      '2026-09-03',
      now,
    );
    expect(occurrences.map((o) => o.title)).toEqual(['Make exercise', 'Read']);
  });

  it('leaves a block without a project unassigned', () => {
    const orphan: BlockPlan = { ...dailyPlan, projectId: null };
    const occurrence = occurrencesForDay(
      [orphan],
      indexOverrides([]),
      projectsById,
      '2026-09-03',
      now,
    )[0];
    expect(occurrence.project).toBeNull();
  });

  const tuesdaysOnly: BlockPlan = {
    ...dailyPlan,
    recurrence: { type: 'weekly', weekdays: [2] },
  };
  const monday = '2026-09-07';

  it('still shows a done override after the plan no longer covers that day', () => {
    const done: BlockOverride = {
      id: 'o1',
      planId: 'p1',
      date: monday,
      status: 'done',
      actualStart: new Date(2026, 8, 7, 5, 31, 12).toISOString(),
      actualEnd: new Date(2026, 8, 7, 6, 17, 40).toISOString(),
      startMinute: null,
      durationMinutes: null,
    };
    const occurrences = occurrencesForDay(
      [tuesdaysOnly],
      indexOverrides([done]),
      projectsById,
      monday,
      now,
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].status).toBe('done');
  });

  it('still shows a running override after the plan no longer covers that day', () => {
    const running: BlockOverride = {
      id: 'o1',
      planId: 'p1',
      date: monday,
      status: 'running',
      actualStart: new Date(2026, 8, 7, 5, 31, 12).toISOString(),
      actualEnd: null,
      startMinute: null,
      durationMinutes: null,
    };
    const occurrences = occurrencesForDay(
      [tuesdaysOnly],
      indexOverrides([running]),
      projectsById,
      monday,
      new Date(2026, 8, 7, 6, 0, 0),
    );
    expect(occurrences).toHaveLength(1);
    expect(occurrences[0].status).toBe('running');
    expect(occurrences[0].displayStart.getMinutes()).toBe(31);
  });

  it('hides a scheduled override on a day the plan no longer covers', () => {
    const scheduled: BlockOverride = {
      id: 'o1',
      planId: 'p1',
      date: monday,
      status: 'scheduled',
      actualStart: null,
      actualEnd: null,
      startMinute: 420,
      durationMinutes: 60,
    };
    expect(
      occurrencesForDay(
        [tuesdaysOnly],
        indexOverrides([scheduled]),
        projectsById,
        monday,
        now,
      ),
    ).toHaveLength(0);
  });

  it('hides a deleted override on a day the plan no longer covers', () => {
    const deleted: BlockOverride = {
      id: 'o1',
      planId: 'p1',
      date: monday,
      status: 'deleted',
      actualStart: null,
      actualEnd: null,
      startMinute: null,
      durationMinutes: null,
    };
    expect(
      occurrencesForDay(
        [tuesdaysOnly],
        indexOverrides([deleted]),
        projectsById,
        monday,
        now,
      ),
    ).toHaveLength(0);
  });
});
