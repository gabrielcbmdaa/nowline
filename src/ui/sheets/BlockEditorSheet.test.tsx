// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockOverride, BlockPlan } from '../../domain/types';
import { repository } from '../../storage/repository';
import { loadAll } from '../../state/store';
import { BlockEditorSheet } from './BlockEditorSheet';

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
      fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
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
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    localStorage.setItem('tt.plans.v1', JSON.stringify([plan]));
    localStorage.setItem('tt.overrides.v1', JSON.stringify([trackedOverride]));
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

  it('reports an unexpected write failure behind the generic message', async () => {
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(repository, 'savePlan').mockRejectedValue(new Error('storage is full'));
    newBlock();

    fill('Title', 'Make exercise');
    clickSave();

    expect(await screen.findByText('Could not save. Please try again.')).toBeTruthy();
    expect(reported).toHaveBeenCalledOnce();
  });
});
