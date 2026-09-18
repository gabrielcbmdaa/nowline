import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { atMinute, minutesSinceMidnight, wallClockMinutesBetween } from '../../domain/dates';
import { minuteToPixel } from '../../domain/geometry';
import type { ResolvedOccurrence } from '../../domain/types';
import { accessibleBlockName, formatTime } from '../format';
import { PlayIcon, StopIcon } from '../icons';
import { dimTowardPage, NO_PROJECT_COLOR, readableTextColor } from '../textColor';
import { useBlockDrag } from './useBlockDrag';

/**
 * A floor with one job: a block stays visible. Five pixels is five minutes at
 * the default scale, and at the smallest scale it is what keeps a five-minute
 * block from disappearing. It is deliberately not what makes the stopwatch
 * button big enough — that is TIMER_MIN_HEIGHT, and separating the two is what
 * closed the 18px floor of 2026-09-05.
 */
const MIN_BLOCK_HEIGHT = 5;

/** Where one line of text is still legible. The figure the old floor carried. */
const TEXT_MIN_HEIGHT = 18;

/**
 * What is tappable of the button is min(34, this block's height), so drawing it
 * below 24 is what used to give an 18px target where WCAG 2.2 SC 2.5.8 asks for
 * 24. Withheld below that, the layout meets the criterion instead of a special
 * case doing it, at every scale. A block under 24px offers no Start: the zoom
 * is how you reach it, and the keyboard can zoom.
 */
const TIMER_MIN_HEIGHT = 24;

/**
 * Stacked, the title and the time measure 30.5px together. At 60px/hour half an
 * hour is exactly 30, so the threshold is 30 and the two lines give up half a
 * pixel: the alternative is that no half-hour block stacks at the default
 * scale, which is the shape most of them have.
 */
const STACKED_MIN_HEIGHT = 30;

/** Matches the dimming the done state used to get from CSS opacity. */
const DONE_DIM = 0.75;

/**
 * Darker than the live fill, and not the 0.75 of a done block: the signal that
 * a touch has been held long enough for the block to follow the finger.
 */
export const ARMED_DIM = 0.7;

type Props = {
  occurrence: ResolvedOccurrence;
  isToday: boolean;
  pixelsPerHour: number;
  onTap: (occurrence: ResolvedOccurrence) => void;
  onToggleTimer: (occurrence: ResolvedOccurrence) => void;
};

export function TimeBlockView({ occurrence, isToday, pixelsPerHour, onTap, onToggleTimer }: Props) {
  const drag = useBlockDrag(occurrence, pixelsPerHour, () => onTap(occurrence));
  const clickFromGesture = useRef(false);

  const startMinute =
    minutesSinceMidnight(occurrence.displayStart, occurrence.date) + drag.offsetMinutes;
  // Marks of the grid, not elapsed time: displayEnd is a real recorded instant on a
  // tracked block, and re-deriving it from a duration moves it an hour twice a year.
  const durationMinutes =
    wallClockMinutesBetween(occurrence.displayStart, occurrence.displayEnd, occurrence.date) +
    drag.extraMinutes;

  const height = Math.max(minuteToPixel(durationMinutes, pixelsPerHour), MIN_BLOCK_HEIGHT);
  // Drawn at its true start and left to overflow the day section, which does not
  // clip: a block that runs into the next day is one rectangle crossing the seam,
  // not two. Sliding it up to fit is what used to draw a 23:50 session at 23:30.
  const top = minuteToPixel(startMinute, pixelsPerHour);

  const baseColor = occurrence.project?.color ?? NO_PROJECT_COLOR;
  const background =
    occurrence.status === 'done'
      ? dimTowardPage(baseColor, DONE_DIM)
      : drag.armed
        ? dimTowardPage(baseColor, ARMED_DIM)
        : baseColor;

  function onBodyPointerDown(event: ReactPointerEvent<HTMLElement>) {
    clickFromGesture.current = false;
    drag.onBodyPointerDown(event);
  }

  function onStartHandlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    clickFromGesture.current = false;
    drag.onHandlePointerDown('start')(event);
  }

  function onEndHandlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    clickFromGesture.current = false;
    drag.onHandlePointerDown('end')(event);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    drag.onPointerUp(event);
    clickFromGesture.current = true;
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    drag.onPointerCancel(event);
    clickFromGesture.current = true;
  }

  const labelStart = atMinute(occurrence.date, startMinute);
  const labelEnd = atMinute(occurrence.date, startMinute + durationMinutes);

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
      aria-label={accessibleBlockName(occurrence.title, labelStart, labelEnd)}
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
        onPointerDown={onStartHandlePointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />

      {height >= TEXT_MIN_HEIGHT && (
        /* One line, title first: two stacked lines are what forced the old 30px floor. */
        <div className="block__text">
          <span className="block__title">{occurrence.title}</span>
          <span className="block__time">
            {formatTime(labelStart)} - {formatTime(labelEnd)}
          </span>
        </div>
      )}

      {height >= TIMER_MIN_HEIGHT &&
        occurrence.status !== 'done' &&
        (isToday || occurrence.status === 'running') && (
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
        onPointerDown={onEndHandlePointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />
    </article>
  );
}
