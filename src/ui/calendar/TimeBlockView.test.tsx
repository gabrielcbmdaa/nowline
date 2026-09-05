// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedOccurrence } from '../../domain/types';
import { TimeBlockView } from './TimeBlockView';

/**
 * A block that ran from 01:30 to 03:30 by the wall clock. Both instants are
 * unambiguous on every day of the year: 01:30 is before either transition and
 * 03:30 is after both, so only the distance between them changes.
 *
 * Runs in Europe/Madrid; vite.config.ts pins the zone for the whole suite.
 */
function doneBlockOn(date: string, month: number, day: number): ResolvedOccurrence {
  return {
    planId: 'p1',
    date,
    title: 'Make exercise',
    project: null,
    status: 'done',
    displayStart: new Date(2026, month, day, 1, 30),
    displayEnd: new Date(2026, month, day, 3, 30),
  };
}

function draw(occurrence: ResolvedOccurrence) {
  const { container } = render(
    <TimeBlockView occurrence={occurrence} isToday={false} onTap={() => {}} onToggleTimer={() => {}} />,
  );
  const block = container.querySelector<HTMLElement>('.block');
  if (!block) throw new Error('no block rendered');
  return {
    label: block.querySelector('.block__time')?.textContent,
    height: block.style.height,
  };
}

describe('TimeBlockView draws a tracked block by the wall clock', () => {
  afterEach(cleanup);

  // 128px is two hours at 64px/hour: the distance between the 01:30 and 03:30 marks.
  const TWO_HOURS = '128px';

  it('on an ordinary day', () => {
    expect(draw(doneBlockOn('2026-09-03', 8, 3))).toEqual({
      label: '1:30 - 3:30',
      height: TWO_HOURS,
    });
  });

  /**
   * The clocks go back, so 02:00-03:00 is lived twice and the stopwatch ran three
   * hours. The grid is still 24 marks tall, so the block still spans two of them.
   * Reading the elapsed figure instead put the end at 04:30 — an hour of work that
   * never happened, written onto a session already finished.
   */
  it('on the day the clocks go back, when three hours passed', () => {
    expect(draw(doneBlockOn('2026-10-25', 9, 25))).toEqual({
      label: '1:30 - 3:30',
      height: TWO_HOURS,
    });
  });

  /**
   * The mirror: the clocks go forward, the stopwatch ran one hour, and the block
   * still spans two marks. Here the label was right by accident before the fix —
   * it asked for the 02:30 mark, which does not exist that day, and JavaScript
   * pushed it to 03:30 — while the block was drawn ending on the 02:30 line. The
   * height is what catches this one.
   */
  it('on the day the clocks go forward, when one hour passed', () => {
    expect(draw(doneBlockOn('2026-03-29', 2, 29))).toEqual({
      label: '1:30 - 3:30',
      height: TWO_HOURS,
    });
  });
});
