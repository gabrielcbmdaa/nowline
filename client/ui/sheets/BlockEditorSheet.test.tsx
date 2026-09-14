// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { BlockOverride, BlockPlan } from '../../domain/types';

vi.mock('../../reportError', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

import { reportError } from '../../reportError';
import { repository } from '../../storage/repository';
import { loadAll } from '../../state/store';
import { BlockEditorSheet } from './BlockEditorSheet';

const reported = reportError as Mock;

const DATE = '2026-09-03';

const plan: BlockPlan = {
  id: 'p1',
  title: 'Make exercise',
  projectId: null,
  startMinute: 9 * 60,
  durationMinutes: 60,
  recurrence: { type: 'none' },
  anchorDate: DATE,
  endDate: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  deletedAt: null,
};

/** Ran from 09:00 to 10:00, so the sheet offers the tracked times for correction. */
const trackedOverride: BlockOverride = {
  id: 'o1',
  planId: 'p1',
  date: DATE,
  status: 'done',
  actualStart: new Date(2026, 8, 3, 9, 0, 0).toISOString(),
  actualEnd: new Date(2026, 8, 3, 10, 0, 0).toISOString(),
  startMinute: null,
  durationMinutes: null,
  updatedAt: new Date(2026, 8, 3, 10, 0, 0).toISOString(),
};

/** Dragged to 10:00 on its day: the editor shows that time and clears it on save. */
const draggedOverride: BlockOverride = {
  id: 'o1',
  planId: 'p1',
  date: DATE,
  status: 'scheduled',
  actualStart: null,
  actualEnd: null,
  startMinute: 10 * 60,
  durationMinutes: 60,
  updatedAt: '2026-09-02T00:00:00.000Z',
};

function newBlock() {
  return render(
    <BlockEditorSheet planId={null} date={DATE} defaultStartMinute={9 * 60} onClose={() => {}} />,
  );
}

function fill(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function clickSave(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('BlockEditorSheet', () => {
  beforeEach(async () => {
    localStorage.clear();
    reported.mockClear();
    await loadAll();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('refuses to save and says why', () => {
    it('when the title is blank', async () => {
      newBlock();
      fill('Title', '   ');
      clickSave();
      expect(await screen.findByText('Title is required')).toBeTruthy();
    });

    it('when the end is not after the start', async () => {
      newBlock();
      fill('Title', 'Make exercise');
      fill('End', '09:00');
      clickSave();
      expect(await screen.findByText('End time must be after start time')).toBeTruthy();
    });

    it('when a weekly repeat has no weekday left', async () => {
      newBlock();
      fill('Title', 'Make exercise');
      fireEvent.click(screen.getByRole('radio', { name: 'Weekly' }));
      // Weekly starts ticked on the day the block sits on, and 2026-09-03 is a
      // Thursday. Asking for it by name is what a screen reader can do too.
      fireEvent.click(screen.getByRole('button', { name: 'Thursday', pressed: true }));

      // Unticking has to be audible too, or every day would announce as picked.
      expect(screen.getByRole('button', { name: 'Thursday', pressed: false })).toBeTruthy();
      clickSave();

      expect(await screen.findByText('Pick at least one weekday')).toBeTruthy();
    });
  });

  it('keeps the precise message when a tracked correction is invalid, without reporting it', async () => {
    localStorage.setItem('nowline.plans.v2', JSON.stringify([plan]));
    localStorage.setItem('nowline.overrides.v2', JSON.stringify([trackedOverride]));
    await loadAll();
    render(
      <BlockEditorSheet planId="p1" date={DATE} defaultStartMinute={9 * 60} onClose={() => {}} />,
    );

    // Moving the start past the untouched end is the one way to invert them:
    // an edited end that lands earlier rolls over to the next day instead.
    fill('Started', '23:00');
    clickSave();

    expect(await screen.findByText('End time must be after start time')).toBeTruthy();
    expect(reported).not.toHaveBeenCalled();
  });

  it('reads an end before the start as the next day and saves the block that crosses midnight', async () => {
    const saved = vi.spyOn(repository, 'savePlan');
    // Opened at 09:00 so the End field is still labelled "End" when it is typed;
    // the label is what tells the user which day the block lands on.
    newBlock();

    fill('Title', 'Late session');
    fill('Start', '23:00');
    fill('End', '00:30');
    clickSave();

    await screen.findByText('End next day');
    expect(saved).toHaveBeenCalledOnce();
    const [plan] = saved.mock.calls[0];
    expect(plan.startMinute).toBe(23 * 60);
    // 23:00 to 00:30 is ninety minutes, not the negative span the clocks suggest.
    expect(plan.durationMinutes).toBe(90);
  });

  it('refuses a block longer than a full turn of the clock', async () => {
    render(
      <BlockEditorSheet planId={null} date={DATE} defaultStartMinute={9 * 60} onClose={() => {}} />,
    );
    fill('Title', 'Too long');
    fill('Start', '09:00');
    fill('End', '08:59');
    clickSave();
    // 08:59 the next day is 23 h 59, which fits. Nothing typeable exceeds a day,
    // so the guard is there for data, not for the field: assert it saves instead.
    expect(await screen.findByText('End next day')).toBeTruthy();
  });

  it('reports an unexpected write failure behind the generic message', async () => {
    vi.spyOn(repository, 'savePlan').mockRejectedValue(new Error('storage is full'));
    newBlock();

    fill('Title', 'Make exercise');
    clickSave();

    expect(await screen.findByText('Could not save. Please try again.')).toBeTruthy();
    expect(reported).toHaveBeenCalledWith('Saving the block failed', expect.any(Error));
  });

  it('reaches the generic message even when the rejection carries nothing', async () => {
    // A bare reject() hands the catch `undefined`. Reading `.message` off that is
    // the one way the old catch could crash inside itself and leave the sheet mute.
    vi.spyOn(repository, 'savePlan').mockRejectedValue(undefined);
    newBlock();

    fill('Title', 'Make exercise');
    clickSave();

    expect(await screen.findByText('Could not save. Please try again.')).toBeTruthy();
    expect(reported).toHaveBeenCalledWith('Saving the block failed', undefined);
  });

  describe('a save that writes two rows', () => {
    async function openDraggedDay(onClose: () => void): Promise<void> {
      localStorage.setItem('nowline.plans.v2', JSON.stringify([plan]));
      localStorage.setItem('nowline.overrides.v2', JSON.stringify([draggedOverride]));
      await loadAll();
      render(
        <BlockEditorSheet planId="p1" date={DATE} defaultStartMinute={9 * 60} onClose={onClose} />,
      );
    }

    function storedDay(): BlockOverride {
      const rows = JSON.parse(localStorage.getItem('nowline.overrides.v2') ?? '[]') as BlockOverride[];
      return rows[0];
    }

    it('says nothing was saved when the day itself could not be written', async () => {
      vi.spyOn(repository, 'saveOverride').mockRejectedValue(new Error('storage is full'));
      const savedPlan = vi.spyOn(repository, 'savePlan');
      const onClose = vi.fn();
      await openDraggedDay(onClose);

      fill('Title', 'Renamed');
      clickSave();

      expect(await screen.findByText('Could not save. Please try again.')).toBeTruthy();
      expect(savedPlan).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      // The day still shadows its plan: nothing reached the disk.
      expect(storedDay().startMinute).toBe(10 * 60);
      expect(reported).toHaveBeenCalledWith('Saving the block failed', expect.any(Error));
    });

    it('says only part was saved when the day was written and the plan was not', async () => {
      vi.spyOn(repository, 'savePlan').mockRejectedValue(new Error('storage is full'));
      const onClose = vi.fn();
      await openDraggedDay(onClose);

      fill('Title', 'Renamed');
      clickSave();

      expect(
        await screen.findByText('Only part of the change was saved. Please try again.'),
      ).toBeTruthy();
      expect(onClose).not.toHaveBeenCalled();
      // The day's own position is gone — it follows its plan now, which the app can
      // always show — and the plan kept its old title. The message has to say so.
      expect(storedDay().startMinute).toBeNull();
      expect(storedDay().durationMinutes).toBeNull();
      expect(reported).toHaveBeenCalledWith(
        'Saving the block failed after its day was written',
        expect.any(Error),
      );
    });
  });

  describe('the repeat choice', () => {
    it('is a group named Repeat, of three radios with one checked', () => {
      newBlock();
      const group = screen.getByRole('group', { name: 'Repeat' });
      expect(within(group).getAllByRole('radio')).toHaveLength(3);
      expect(within(group).getByRole('radio', { name: 'Does not repeat', checked: true })).toBeTruthy();

      fireEvent.click(screen.getByRole('radio', { name: 'Every day' }));

      expect(screen.getByRole('radio', { name: 'Every day', checked: true })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Does not repeat', checked: false })).toBeTruthy();
    });

    it('keeps the picked weekdays when Weekly is clicked again', () => {
      newBlock();
      fireEvent.click(screen.getByRole('radio', { name: 'Weekly' }));
      // 2026-09-03 is a Thursday, ticked by default; add two more.
      fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
      fireEvent.click(screen.getByRole('button', { name: 'Friday' }));

      fireEvent.click(screen.getByRole('radio', { name: 'Weekly' }));

      // Measured in Chrome on 2026-09-13: this click used to reset the week to the sheet's day.
      for (const day of ['Wednesday', 'Thursday', 'Friday']) {
        expect(screen.getByRole('button', { name: day, pressed: true })).toBeTruthy();
      }
    });
  });
});
