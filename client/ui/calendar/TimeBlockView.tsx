import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { atMinute, minutesSinceMidnight, wallClockMinutesBetween } from '../../domain/dates';
import { minuteToPixel } from '../../domain/geometry';
import type { ResolvedOccurrence } from '../../domain/types';
import { formatTime } from '../format';
import { PlayIcon, StopIcon } from '../icons';
import { dimTowardPage, NO_PROJECT_COLOR, readableTextColor } from '../textColor';
import { useBlockDrag } from './useBlockDrag';

/**
 * A quarter hour is 16px at the current scale, so this floor is what makes short
 * blocks look longer than they are. 18 keeps the single line of text legible while
 * inflating a 15-minute block by 2px instead of 14.
 */
const MIN_BLOCK_HEIGHT = 18;

/**
 * Stacked, the title and the time measure 30.5px together, so only blocks of half
 * an hour or more can hold both lines. Shorter ones keep them side by side.
 */
const STACKED_MIN_HEIGHT = 32;

/** Matches the dimming the done state used to get from CSS opacity. */
const DONE_DIM = 0.75;

type Props = {
  occurrence: ResolvedOccurrence;
  isToday: boolean;
  onTap: (occurrence: ResolvedOccurrence) => void;
  onToggleTimer: (occurrence: ResolvedOccurrence) => void;
};

export function TimeBlockView({ occurrence, isToday, onTap, onToggleTimer }: Props) {
  const drag = useBlockDrag(occurrence, () => onTap(occurrence));
  const clickFromGesture = useRef(false);

  const startMinute =
    minutesSinceMidnight(occurrence.displayStart, occurrence.date) + drag.offsetMinutes;
  // Marks of the grid, not elapsed time: displayEnd is a real recorded instant on a
  // tracked block, and re-deriving it from a duration moves it an hour twice a year.
  const durationMinutes =
    wallClockMinutesBetween(occurrence.displayStart, occurrence.displayEnd, occurrence.date) +
    drag.extraMinutes;

  const height = Math.max(minuteToPixel(durationMinutes), MIN_BLOCK_HEIGHT);
  // Drawn at its true start and left to overflow the day section, which does not
  // clip: a block that runs into the next day is one rectangle crossing the seam,
  // not two. Sliding it up to fit is what used to draw a 23:50 session at 23:30.
  const top = minuteToPixel(startMinute);

  const baseColor = occurrence.project?.color ?? NO_PROJECT_COLOR;
  const background =
    occurrence.status === 'done' ? dimTowardPage(baseColor, DONE_DIM) : baseColor;

  function markPointerStart() {
    clickFromGesture.current = false;
  }

  function onBodyPointerDown(event: ReactPointerEvent<HTMLElement>) {
    markPointerStart();
    drag.onBodyPointerDown(event);
  }

  function onHandlePointerDown(edge: 'start' | 'end') {
    return (event: ReactPointerEvent<HTMLElement>) => {
      markPointerStart();
      drag.onHandlePointerDown(edge)(event);
    };
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    drag.onPointerUp(event);
    clickFromGesture.current = true;
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    drag.onPointerCancel(event);
    clickFromGesture.current = true;
  }

  return (
    <article
      className={['block', `block--${occurrence.status}`, height >= STACKED_MIN_HEIGHT ? 'block--stacked' : '']
        .filter(Boolean)
        .join(' ')}
      style={{
        top,
        height,
        background,
        color: readableTextColor(background),
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onTap(occurrence);
        }
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (!clickFromGesture.current) onTap(occurrence);
      }}
      onPointerDown={onBodyPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <span
        className="block__handle block__handle--start"
        aria-hidden={true}
        onPointerDown={onHandlePointerDown('start')}
        onPointerMove={drag.onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />

      {/* One line, title first: two stacked lines are what forced the old 30px floor. */}
      <div className="block__text">
        <span className="block__title">{occurrence.title}</span>
        <span className="block__time">
          {formatTime(atMinute(occurrence.date, startMinute))} - {formatTime(atMinute(occurrence.date, startMinute + durationMinutes))}
        </span>
      </div>

      {occurrence.status !== 'done' && (isToday || occurrence.status === 'running') && (
        <button
          className="block__timer"
          aria-label={occurrence.status === 'running' ? 'Stop' : 'Start'}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onToggleTimer(occurrence);
          }}
        >
          {occurrence.status === 'running' ? (
            <StopIcon className="block__timer-icon" />
          ) : (
            <PlayIcon className="block__timer-icon" />
          )}
        </button>
      )}

      <span
        className="block__handle block__handle--end"
        aria-hidden={true}
        onPointerDown={onHandlePointerDown('end')}
        onPointerMove={drag.onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    </article>
  );
}
