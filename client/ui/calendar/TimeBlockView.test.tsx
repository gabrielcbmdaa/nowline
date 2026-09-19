// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, dateKeyToMidnight } from '../../domain/dates';
import { DEFAULT_PIXELS_PER_HOUR } from '../../domain/geometry';
import { resolveOccurrence } from '../../domain/recurrence';
import type { BlockPlan, ResolvedOccurrence } from '../../domain/types';
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
    <TimeBlockView occurrence={occurrence} isToday={false} pixelsPerHour={DEFAULT_PIXELS_PER_HOUR} onTap={() => {}} onToggleTimer={() => {}} />,
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

  // 120px is two hours at 60px/hour: the distance between the 01:30 and 03:30 marks.
  const TWO_HOURS = '120px';

  it('on an ordinary day', () => {
    expect(draw(doneBlockOn('2026-09-03', 8, 3))).toEqual({
      label: '1:30 - 3:30',
      height: TWO_HOURS,
      top: '90px',
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
      top: '90px',
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
      top: '90px',
    });
  });
});

/**
 * A plan at 01:00 for three hours, resolved for the day asked: what the calendar
 * really draws, not a hand-built occurrence. The DST tests above build the
 * occurrence by hand because there a tracked block is the subject; here the
 * resolver is.
 */
function scheduledBlockOn(date: string, month: number, day: number): ResolvedOccurrence {
  const plan: BlockPlan = {
    id: 'p1',
    title: 'Make exercise',
    projectId: null,
    startMinute: 60,
    durationMinutes: 180,
    recurrence: { type: 'none' },
    anchorDate: date,
    endDate: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
  };
  const occurrence = resolveOccurrence(plan, null, null, date, new Date(2026, month, day, 12, 0));
  if (occurrence === null) throw new Error('expected an occurrence');
  return occurrence;
}

describe('TimeBlockView draws a planned block at its planned length', () => {
  afterEach(cleanup);

  // 180px is three hours at 60px/hour: the distance between the 01:00 and 04:00 marks.
  const THREE_HOURS = '180px';

  it('on an ordinary day', () => {
    expect(draw(scheduledBlockOn('2026-10-18', 9, 18))).toEqual({
      label: '1:00 - 4:00',
      height: THREE_HOURS,
      top: '60px',
    });
  });

  it('on the day the clocks go back, which used to draw it two hours tall', () => {
    expect(draw(scheduledBlockOn('2026-10-25', 9, 25))).toEqual({
      label: '1:00 - 4:00',
      height: THREE_HOURS,
      top: '60px',
    });
  });

  it('on the day the clocks go forward, which used to draw it four hours tall', () => {
    expect(draw(scheduledBlockOn('2026-03-29', 2, 29))).toEqual({
      label: '1:00 - 4:00',
      height: THREE_HOURS,
      top: '60px',
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
    // 23:50 is 1430 minutes in, and at one pixel a minute that is pixel 1430.
    // The old clamp answered 1493.33 here, which is 23:20 — half an hour early.
    expect(draw(crossing)).toEqual({
      label: '11:50 - 12:20',
      height: '30px',
      top: '1430px',
    });
  });

  it('is one rectangle, drawn once, that reaches past the end of its day', () => {
    const { container } = render(
      <TimeBlockView occurrence={crossing} isToday={false} pixelsPerHour={DEFAULT_PIXELS_PER_HOUR} onTap={() => {}} onToggleTimer={() => {}} />,
    );
    expect(container.querySelectorAll('.block')).toHaveLength(1);
    const block = container.querySelector<HTMLElement>('.block');
    // 1440 is a full day at the default scale; the last half hour of this block is drawn below it.
    expect(parseFloat(block!.style.top) + parseFloat(block!.style.height)).toBeGreaterThan(
      1440,
    );
  });
});

const lunch: ResolvedOccurrence = {
  planId: 'p1',
  date: '2026-09-14',
  title: 'Lunch',
  project: null,
  status: 'done',
  displayStart: new Date(2026, 8, 14, 11, 30),
  displayEnd: new Date(2026, 8, 14, 12, 15),
};

describe('TimeBlockView accessible name includes the half of the clock', () => {
  afterEach(cleanup);

  it('names a crossing block with both meridiems, without changing the painted time', () => {
    render(
      <TimeBlockView occurrence={crossing} isToday={false} pixelsPerHour={DEFAULT_PIXELS_PER_HOUR} onTap={() => {}} onToggleTimer={() => {}} />,
    );
    expect(
      screen.getByRole('button', { name: 'Late session, 11:50 PM - 12:20 AM' }),
    ).toBeTruthy();
    expect(document.querySelector('.block__time')?.textContent).toBe('11:50 - 12:20');
  });

  it('names a lunch block with AM then PM, so the meridiem is not a midnight special', () => {
    render(
      <TimeBlockView occurrence={lunch} isToday={false} pixelsPerHour={DEFAULT_PIXELS_PER_HOUR} onTap={() => {}} onToggleTimer={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Lunch, 11:30 AM - 12:15 PM' })).toBeTruthy();
    expect(document.querySelector('.block__time')?.textContent).toBe('11:30 - 12:15');
  });
});

function shortBlock(durationMinutes: number): ResolvedOccurrence {
  return {
    planId: 'p1',
    date: '2026-09-17',
    title: 'Stretch',
    project: null,
    status: 'scheduled',
    displayStart: new Date(2026, 8, 17, 10, 0),
    displayEnd: new Date(2026, 8, 17, 10, durationMinutes),
  };
}

function drawAt(occurrence: ResolvedOccurrence, pixelsPerHour: number) {
  const { container } = render(
    <TimeBlockView
      occurrence={occurrence}
      isToday={true}
      pixelsPerHour={pixelsPerHour}
      onTap={() => {}}
      onToggleTimer={() => {}}
    />,
  );
  const block = container.querySelector<HTMLElement>('.block');
  if (!block) throw new Error('no block rendered');
  return {
    height: block.style.height,
    hasText: block.querySelector('.block__text') !== null,
    hasTimer: block.querySelector('.block__timer') !== null,
    stacked: block.classList.contains('block--stacked'),
  };
}

describe('what a block draws depends on how tall it is, not on the zoom', () => {
  afterEach(cleanup);

  it('keeps a five-minute block visible and says nothing else', () => {
    // 5 minutes at 30px/hour is 2.5px; the floor holds it at 5 so it is still seen.
    expect(drawAt(shortBlock(5), 30)).toEqual({
      height: '5px',
      hasText: false,
      hasTimer: false,
      stacked: false,
    });
  });

  it('adds the text at 18px, where one line stays legible', () => {
    // 18 minutes at 60px/hour is 18px.
    expect(drawAt(shortBlock(18), 60)).toEqual({
      height: '18px',
      hasText: true,
      hasTimer: false,
      stacked: false,
    });
  });

  it('withholds the stopwatch one pixel below the 24 WCAG 2.5.8 asks for', () => {
    expect(drawAt(shortBlock(23), 60).hasTimer).toBe(false);
    expect(drawAt(shortBlock(24), 60).hasTimer).toBe(true);
  });

  it('offers the stopwatch to a short block once the zoom makes room', () => {
    // A quarter hour is 15px at 60 and 24px at 96: the same block, zoomed.
    expect(drawAt(shortBlock(15), 60).hasTimer).toBe(false);
    expect(drawAt(shortBlock(15), 96).hasTimer).toBe(true);
  });

  it('gives a 48-minute block its stopwatch even at the smallest scale', () => {
    // 48 minutes at 30px/hour is 24px. A rule by zoom level would have taken
    // the button from a block with room for it.
    expect(drawAt(shortBlock(48), 30).hasTimer).toBe(true);
  });

  it('stacks the two lines from half an hour at the default scale', () => {
    expect(drawAt(shortBlock(29), 60).stacked).toBe(false);
    expect(drawAt(shortBlock(30), 60).stacked).toBe(true);
  });
});
