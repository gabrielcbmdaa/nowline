import { describe, expect, it } from 'vitest';
import type { BlockOverride, BlockPlan, Project } from './types';
import { formatDuration, totalsByProject } from './summary';

const health: Project = {
  id: 'health',
  name: 'Health',
  color: '#E5484D',
  createdAt: '2026-09-01T00:00:00.000Z',
};
const work: Project = {
  id: 'work',
  name: 'Work',
  color: '#0091FF',
  createdAt: '2026-09-01T00:00:00.000Z',
};

const exercise: BlockPlan = {
  id: 'p1',
  title: 'Make exercise',
  projectId: 'health',
  startMinute: 300,
  durationMinutes: 120,
  recurrence: { type: 'daily' },
  anchorDate: '2026-09-01',
  endDate: null,
  createdAt: '2026-09-01T00:00:00.000Z',
};
const coding: BlockPlan = { ...exercise, id: 'p2', title: 'Coding', projectId: 'work' };

function done(planId: string, date: string, from: Date, to: Date): BlockOverride {
  return {
    id: `${planId}-${date}`,
    planId,
    date,
    status: 'done',
    actualStart: from.toISOString(),
    actualEnd: to.toISOString(),
    startMinute: null,
    durationMinutes: null,
  };
}

describe('totalsByProject', () => {
  it('sums only stopped blocks inside the range, biggest first', () => {
    const overrides = [
      done('p1', '2026-09-03', new Date(2026, 8, 3, 5, 0, 0), new Date(2026, 8, 3, 6, 0, 0)),
      done('p2', '2026-09-03', new Date(2026, 8, 3, 9, 0, 0), new Date(2026, 8, 3, 12, 0, 0)),
      // Outside the range.
      done('p1', '2026-09-05', new Date(2026, 8, 5, 5, 0, 0), new Date(2026, 8, 5, 9, 0, 0)),
      // Running, so it counts as nothing yet.
      {
        ...done('p1', '2026-09-03', new Date(), new Date()),
        id: 'running',
        status: 'running' as const,
        actualEnd: null,
      },
    ];

    const totals = totalsByProject(
      [exercise, coding],
      overrides,
      [health, work],
      '2026-09-03',
      '2026-09-03',
    );

    expect(totals.map((t) => [t.project?.name, t.seconds])).toEqual([
      ['Work', 10800],
      ['Health', 3600],
    ]);
  });

  it('groups blocks with no project under a null project', () => {
    const orphan: BlockPlan = { ...exercise, id: 'p3', projectId: null };
    const totals = totalsByProject(
      [orphan],
      [done('p3', '2026-09-03', new Date(2026, 8, 3, 5, 0, 0), new Date(2026, 8, 3, 5, 30, 0))],
      [health],
      '2026-09-03',
      '2026-09-03',
    );
    expect(totals).toHaveLength(1);
    expect(totals[0].project).toBeNull();
    expect(totals[0].seconds).toBe(1800);
  });

  it('ignores overrides whose plan no longer exists', () => {
    const totals = totalsByProject(
      [],
      [done('ghost', '2026-09-03', new Date(2026, 8, 3, 5, 0, 0), new Date(2026, 8, 3, 6, 0, 0))],
      [health],
      '2026-09-03',
      '2026-09-03',
    );
    expect(totals).toEqual([]);
  });

  it('merges dangling project references with explicit null projects', () => {
    const explicit: BlockPlan = { ...exercise, id: 'p3', projectId: null };
    const dangling: BlockPlan = { ...exercise, id: 'p4', projectId: 'phantom' };
    const totals = totalsByProject(
      [explicit, dangling],
      [
        done('p3', '2026-09-03', new Date(2026, 8, 3, 5, 0, 0), new Date(2026, 8, 3, 5, 15, 0)),
        done('p4', '2026-09-03', new Date(2026, 8, 3, 5, 0, 0), new Date(2026, 8, 3, 5, 45, 0)),
      ],
      [health],
      '2026-09-03',
      '2026-09-03',
    );
    expect(totals).toHaveLength(1);
    expect(totals[0].project).toBeNull();
    expect(totals[0].seconds).toBe(3600); // 15 min + 45 min
  });
});

describe('formatDuration', () => {
  it('rounds to the nearest minute for display', () => {
    expect(formatDuration(2788)).toBe('0h 46m'); // 46 min 28 s
    expect(formatDuration(1728)).toBe('0h 29m'); // 28 min 48 s
    expect(formatDuration(5400)).toBe('1h 30m');
    expect(formatDuration(0)).toBe('0h 0m');
  });

  it('handles hour rollover when rounding to the nearest minute', () => {
    expect(formatDuration(3599)).toBe('1h 0m'); // 59 min 59 s rounds to 60 min
  });
});
