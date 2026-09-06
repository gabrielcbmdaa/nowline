// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, dateKeyToMidnight } from '../../domain/dates';
import type { ResolvedOccurrence } from '../../domain/types';
import { TimeBlockView } from './TimeBlockView';

/**
 * How long a calendar day lasted. The three cases below only mean anything in a zone
 * that moves its clocks: in UTC a 01:30 to 03:30 block spans two hours on every day
 * of the year, so they would all pass while testing nothing at all.
 */
function hoursIn(key: string): number {
  return (dateKeyToMidnight(addDays(key, 1)).getTime() - dateKeyToMidnight(key).getTime()) / 3600000;
}

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
    top: block.style.top,
  };
}

describe('TimeBlockView draws a tracked block by the wall clock', () => {
  afterEach(cleanup);

  it('runs where these days are not 24 hours long, or the rest proves nothing', () => {
    expect(hoursIn('2026-03-29')).toBe(23);
    expect(hoursIn('2026-10-25')).toBe(25);
    expect(hoursIn('2026-09-03')).toBe(24);
  });

  // 128px is two hours at 64px/hour: the distance between the 01:30 and 03:30 marks.
  const TWO_HOURS = '128px';

  it('on an ordinary day', () => {
    expect(draw(doneBlockOn('2026-09-03', 8, 3))).toEqual({
      label: '1:30 - 3:30',
      height: TWO_HOURS,
      top: '96px',
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
      top: '96px',
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
      top: '96px',
    });
  });
});

/**
 * A block that ran from 23:50 to 00:20. Before 2026-09-05 the calendar drew this at
 * 23:30-00:00 — the right length in the wrong place, because the rectangle was slid
 * up to fit inside the day instead of being allowed to leave it. The stopwatch has
 * always been able to produce one of these; nothing had to be dragged for it.
 */
const crossing: ResolvedOccurrence = {
  planId: 'p1',
  date: '2026-09-05',
  title: 'Late session',
  project: null,
  status: 'done',
  displayStart: new Date(2026, 8, 5, 23, 50),
  displayEnd: new Date(2026, 8, 6, 0, 20),
};

describe('a block that runs past midnight overflows its day instead of moving', () => {
  afterEach(cleanup);

  it('starts at its true minute and keeps its whole length', () => {
    // 23:50 is 1430 minutes in, and 1430/60*64 is 1525.33: where 23:50 actually is.
    // The old clamp answered 1493.33 here, which is 23:20 — half an hour early.
    expect(draw(crossing)).toEqual({
      label: '11:50 - 12:20',
      height: '32px',
      top: '1525.3333333333333px',
    });
  });

  it('is one rectangle, drawn once, that reaches past the end of its day', () => {
    const { container } = render(
      <TimeBlockView occurrence={crossing} isToday={false} onTap={() => {}} onToggleTimer={() => {}} />,
    );
    expect(container.querySelectorAll('.block')).toHaveLength(1);
    const block = container.querySelector<HTMLElement>('.block');
    // DAY_HEIGHT is 1536; the last half hour of this block is drawn below it.
    expect(parseFloat(block!.style.top) + parseFloat(block!.style.height)).toBeGreaterThan(
      1536,
    );
  });
});
