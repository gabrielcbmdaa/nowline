import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { atMinute, minutesSinceMidnight } from '../../domain/dates';
import { DAY_HEIGHT, minuteToPixel } from '../../domain/geometry';
import type { ResolvedOccurrence } from '../../domain/types';
import { formatTime } from '../format';
import { PlayIcon, StopIcon } from '../icons';
import { dimTowardPage, NO_PROJECT_COLOR, readableTextColor } from '../textColor';
import { useBlockDrag } from './useBlockDrag';

/** Small enough to read, big enough to hit with a thumb. */
const MIN_BLOCK_HEIGHT = 30;

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
  const durationMinutes =
    (occurrence.displayEnd.getTime() - occurrence.displayStart.getTime()) / 60000 +
    drag.extraMinutes;

  const height = Math.max(minuteToPixel(durationMinutes), MIN_BLOCK_HEIGHT);
  // Min height would push a short late block into the next day; sit it a few
  // pixels above its true start so it stays inside this day.
  const top = Math.min(minuteToPixel(startMinute), DAY_HEIGHT - height);

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
      className={`block block--${occurrence.status}`}
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
