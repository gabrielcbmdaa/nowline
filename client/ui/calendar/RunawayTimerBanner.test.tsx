// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, atMinute, dateKeyToMidnight } from '../../domain/dates';
import type { BlockOverride, BlockPlan } from '../../domain/types';
import { loadAll } from '../../state/store';
import { RunawayTimerBanner } from './RunawayTimerBanner';

/** How long a calendar day lasted; the 25-10 case means nothing where it is 24. */
function hoursIn(key: string): number {
  return (dateKeyToMidnight(addDays(key, 1)).getTime() - dateKeyToMidnight(key).getTime()) / 3600000;
}

/**
 * A 180-minute block whose timer was started at `startMinute` on `date` and never
 * stopped, seen at 14:00 that day. The clock is set BEFORE loadAll, because loadAll
 * is what stamps `now` into the store. vi.setSystemTime without vi.useFakeTimers
 * mocks Date and leaves real the timers findByRole waits on.
 */
async function runningSince(date: string, startMinute: number): Promise<Date> {
  const start = atMinute(date, startMinute);
  const plan: BlockPlan = {
    id: 'p1',
    title: 'Deep work',
    projectId: null,
    startMinute,
    durationMinutes: 180,
    recurrence: { type: 'none' },
    anchorDate: date,
    endDate: null,
    createdAt: start.toISOString(),
    updatedAt: start.toISOString(),
    deletedAt: null,
  };
  const running: BlockOverride = {
    id: 'o1',
    planId: 'p1',
    date,
    status: 'running',
    actualStart: start.toISOString(),
    actualEnd: null,
    startMinute: null,
    durationMinutes: null,
    updatedAt: start.toISOString(),
  };
  localStorage.setItem('nowline.plans.v2', JSON.stringify([plan]));
  localStorage.setItem('nowline.overrides.v2', JSON.stringify([running]));
  vi.setSystemTime(atMinute(date, 14 * 60));
  await loadAll();
  return start;
}

function storedOverride(): BlockOverride {
  const rows = JSON.parse(localStorage.getItem('nowline.overrides.v2') ?? '[]') as BlockOverride[];
  return rows[0];
}

describe('RunawayTimerBanner', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('runs where these days are not 24 hours long, or the rest proves nothing', () => {
    expect(hoursIn('2026-10-25')).toBe(25);
    // The control: an ordinary Sunday a week earlier.
    expect(hoursIn('2026-10-18')).toBe(24);
  });

  it('stays hidden while the timer is under twelve hours', async () => {
    // 03:00 to 14:00 is eleven hours: the fixture measures what it thinks it measures.
    await runningSince('2026-10-18', 3 * 60);
    render(<RunawayTimerBanner onFixTimes={() => {}} />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('stops at the planned end in marks of the grid on the day the clocks go back', async () => {
    // 01:00 on the 25-hour day, thirteen elapsed hours before 14:00.
    const start = await runningSince('2026-10-25', 60);
    render(<RunawayTimerBanner onFixTimes={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop at planned end' }));

    await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    const stopped = storedOverride();
    expect(stopped.status).toBe('done');
    // Three marks after 01:00 is 04:00, where the calendar draws the planned end —
    // four elapsed hours on this day. Elapsed arithmetic stops it at 03:00, one mark short.
    expect(stopped.actualEnd).toBe(atMinute('2026-10-25', 240).toISOString());
    expect(stopped.actualEnd).not.toBe(new Date(start.getTime() + 180 * 60000).toISOString());
  });

  it('agrees with elapsed time on an ordinary day, which is why that day is only the control', async () => {
    const start = await runningSince('2026-10-18', 60);
    render(<RunawayTimerBanner onFixTimes={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Stop at planned end' }));

    await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    const end = storedOverride().actualEnd;
    expect(end).toBe(atMinute('2026-10-18', 240).toISOString());
    // Spelled out so the reader sees the control cannot tell the two formulas apart.
    expect(end).toBe(new Date(start.getTime() + 180 * 60000).toISOString());
  });
});
