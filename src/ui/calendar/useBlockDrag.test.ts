import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY, SNAP_MINUTES } from '../../domain/geometry';
import { nextPosition, type DragMode, type Position } from './useBlockDrag';

function staysInsideTheDay(position: Position): void {
  expect(position.startMinute).toBeGreaterThanOrEqual(0);
  expect(position.startMinute + position.durationMinutes).toBeLessThanOrEqual(
    MINUTES_PER_DAY,
  );
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

  it('stops a 2-hour block at 22:00–24:00 and never crosses midnight', () => {
    expect(
      nextPosition(
        'move',
        { startMinute: 9 * 60, durationMinutes: 2 * 60 },
        MINUTES_PER_DAY,
      ),
    ).toEqual({
      startMinute: MINUTES_PER_DAY - 2 * 60,
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

  it('stops an end-resize far down exactly at midnight', () => {
    const startMinute = 9 * 60;
    expect(
      nextPosition('end', { startMinute, durationMinutes: 60 }, MINUTES_PER_DAY),
    ).toEqual({
      startMinute,
      durationMinutes: MINUTES_PER_DAY - startMinute,
    });
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

  it('moves a 1-minute block to the last minute of the day instead of past midnight', () => {
    const next = nextPosition(
      'move',
      { startMinute: 0, durationMinutes: 1 },
      MINUTES_PER_DAY,
    );
    expect(next).toEqual({
      startMinute: MINUTES_PER_DAY - 1,
      durationMinutes: 1,
    });
    staysInsideTheDay(next);
  });

  it('end-resizes a 23:59–24:00 block without growing past midnight', () => {
    const startMinute = MINUTES_PER_DAY - 1;
    const next = nextPosition(
      'end',
      { startMinute, durationMinutes: 1 },
      MINUTES_PER_DAY,
    );
    expect(next).toEqual({ startMinute, durationMinutes: 1 });
    staysInsideTheDay(next);
  });

  it('top-resizes 00:00–00:01 to stay at midnight instead of a negative start', () => {
    const next = nextPosition(
      'start',
      { startMinute: 0, durationMinutes: 1 },
      MINUTES_PER_DAY,
    );
    expect(next).toEqual({ startMinute: 0, durationMinutes: 1 });
    staysInsideTheDay(next);
  });

  it('keeps the degenerate {0, 0} origin inside the day in every mode', () => {
    const origin: Position = { startMinute: 0, durationMinutes: 0 };
    const modes: DragMode[] = ['move', 'end', 'start'];
    for (const mode of modes) {
      for (const delta of [-MINUTES_PER_DAY, 0, MINUTES_PER_DAY]) {
        staysInsideTheDay(nextPosition(mode, origin, delta));
      }
    }
  });
});
