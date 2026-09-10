import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, SNAP_MINUTES } from '../../domain/geometry';
import { nextPosition, type DragMode, type Position } from './useBlockDrag';

/**
 * What a gesture may never produce. Midnight stopped being one of these on
 * 2026-09-05: a block that runs into the next day is drawn as two rectangles,
 * so only its start has to sit inside the day. A full turn of the clock is
 * still a wall, because the calendar looks exactly one day back for the tail.
 */
function startsInsideTheDay(position: Position): void {
  expect(position.startMinute).toBeGreaterThanOrEqual(0);
  expect(position.startMinute).toBeLessThan(MINUTES_PER_DAY);
  expect(position.durationMinutes).toBeLessThanOrEqual(MINUTES_PER_DAY);
}

describe('nextPosition', () => {
  it('moves 09:00–10:00 down by one snap to 09:15–10:15', () => {
    expect(
      nextPosition('move', { startMinute: 9 * 60, durationMinutes: 60 }, SNAP_MINUTES),
    ).toEqual({
      startMinute: 9 * 60 + SNAP_MINUTES,
      durationMinutes: 60,
    });
  });

  it('moves a 2-hour block down to 23:45 and lets it end at 01:45 the next day', () => {
    expect(
      nextPosition(
        'move',
        { startMinute: 9 * 60, durationMinutes: 2 * 60 },
        MINUTES_PER_DAY,
      ),
    ).toEqual({
      startMinute: MINUTES_PER_DAY - SNAP_MINUTES,
      durationMinutes: 2 * 60,
    });
  });

  it('stops a move far up at 00:00 and keeps the duration', () => {
    expect(
      nextPosition(
        'move',
        { startMinute: 9 * 60, durationMinutes: 60 },
        -MINUTES_PER_DAY,
      ),
    ).toEqual({
      startMinute: 0,
      durationMinutes: 60,
    });
  });

  it('stops an end-resize shorter than one snap step at SNAP_MINUTES', () => {
    expect(
      nextPosition(
        'end',
        { startMinute: 9 * 60, durationMinutes: 60 },
        -MINUTES_PER_DAY,
      ),
    ).toEqual({
      startMinute: 9 * 60,
      durationMinutes: SNAP_MINUTES,
    });
  });

  it('stops an end-resize far down at a full turn of the clock, not at midnight', () => {
    const startMinute = 9 * 60;
    expect(
      nextPosition('end', { startMinute, durationMinutes: 60 }, 2 * MINUTES_PER_DAY),
    ).toEqual({
      startMinute,
      durationMinutes: MINUTES_PER_DAY,
    });
  });

  it('end-resizes 23:00–23:30 past midnight, which used to stop dead at one hour', () => {
    const startMinute = 23 * 60;
    expect(
      nextPosition('end', { startMinute, durationMinutes: 30 }, 2 * 60),
    ).toEqual({
      startMinute,
      // 23:00 + 2h30 = 01:30 the next day. The old clamp returned 60 here.
      durationMinutes: 2 * 60 + 30,
    });
  });

  it('end-resizes a 15-minute block at 23:45 past midnight', () => {
    const startMinute = MINUTES_PER_DAY - SNAP_MINUTES;
    const next = nextPosition('end', { startMinute, durationMinutes: SNAP_MINUTES }, 60);
    expect(next).toEqual({ startMinute, durationMinutes: SNAP_MINUTES + 60 });
    startsInsideTheDay(next);
  });

  it('top-resizes 10:00–11:00 by −15 to 09:45–11:00, with the end unchanged', () => {
    const origin = { startMinute: 10 * 60, durationMinutes: 60 };
    const next = nextPosition('start', origin, -SNAP_MINUTES);
    expect(next).toEqual({
      startMinute: 10 * 60 - SNAP_MINUTES,
      durationMinutes: 60 + SNAP_MINUTES,
    });
    expect(next.startMinute + next.durationMinutes).toBe(
      origin.startMinute + origin.durationMinutes,
    );
  });

  it('top-resizes 10:00–11:00 far down to 10:45–11:00, with the end unchanged', () => {
    const origin = { startMinute: 10 * 60, durationMinutes: 60 };
    const next = nextPosition('start', origin, MINUTES_PER_DAY);
    expect(next).toEqual({
      startMinute: 10 * 60 + 60 - SNAP_MINUTES,
      durationMinutes: SNAP_MINUTES,
    });
    expect(next.startMinute + next.durationMinutes).toBe(
      origin.startMinute + origin.durationMinutes,
    );
  });

  it('snaps a block starting at an odd minute onto the quarter-hour grid', () => {
    expect(
      nextPosition('move', { startMinute: 5 * 60 + 7, durationMinutes: 60 }, 0),
    ).toEqual({
      startMinute: 5 * 60,
      durationMinutes: 60,
    });
  });

  it('moves a 1-minute block no further than the last quarter hour of the day', () => {
    const next = nextPosition(
      'move',
      { startMinute: 0, durationMinutes: 1 },
      MINUTES_PER_DAY,
    );
    expect(next).toEqual({
      startMinute: MINUTES_PER_DAY - SNAP_MINUTES,
      durationMinutes: 1,
    });
    startsInsideTheDay(next);
  });

  it('end-resizes a 23:59–24:00 block into the next day', () => {
    const startMinute = MINUTES_PER_DAY - 1;
    const next = nextPosition(
      'end',
      { startMinute, durationMinutes: 1 },
      MINUTES_PER_DAY,
    );
    expect(next).toEqual({ startMinute, durationMinutes: MINUTES_PER_DAY });
    startsInsideTheDay(next);
  });

  it('top-resizes a block that ends after midnight without following it out of the day', () => {
    // 23:30 for 45 minutes ends at 00:15. Dragging the top handle down used to clamp
    // the start to endMinute - SNAP = 1440, i.e. midnight of a day the block does not
    // belong to: the stored startMinute was out of range and the block was drawn twice.
    const next = nextPosition(
      'start',
      { startMinute: 23 * 60 + 30, durationMinutes: 45 },
      MINUTES_PER_DAY,
    );
    expect(next.startMinute).toBe(MINUTES_PER_DAY - SNAP_MINUTES);
    startsInsideTheDay(next);
  });

  it('top-resizes 00:00–00:01 to stay at midnight instead of a negative start', () => {
    const next = nextPosition(
      'start',
      { startMinute: 0, durationMinutes: 1 },
      MINUTES_PER_DAY,
    );
    expect(next).toEqual({ startMinute: 0, durationMinutes: 1 });
    startsInsideTheDay(next);
  });

  it('keeps the degenerate {0, 0} origin within bounds in every mode', () => {
    const origin: Position = { startMinute: 0, durationMinutes: 0 };
    const modes: DragMode[] = ['move', 'end', 'start'];
    for (const mode of modes) {
      for (const delta of [-MINUTES_PER_DAY, 0, MINUTES_PER_DAY]) {
        startsInsideTheDay(nextPosition(mode, origin, delta));
      }
    }
  });
});
