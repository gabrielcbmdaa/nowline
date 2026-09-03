import { minutesSinceMidnight } from '../../domain/dates';
import { minuteToPixel } from '../../domain/geometry';
import type { ResolvedOccurrence } from '../../domain/types';
import { formatTime } from '../format';
import { dimTowardPage, NO_PROJECT_COLOR, readableTextColor } from '../textColor';

/** Small enough to read, big enough to hit with a thumb. */
const MIN_BLOCK_HEIGHT = 30;

/** Matches the dimming the done state used to get from CSS opacity. */
const DONE_DIM = 0.75;

type Props = {
  occurrence: ResolvedOccurrence;
  onTap: (occurrence: ResolvedOccurrence) => void;
};

export function TimeBlockView({ occurrence, onTap }: Props) {
  const startMinute = minutesSinceMidnight(occurrence.displayStart, occurrence.date);
  const durationMinutes =
    (occurrence.displayEnd.getTime() - occurrence.displayStart.getTime()) / 60000;

  const baseColor = occurrence.project?.color ?? NO_PROJECT_COLOR;
  const background =
    occurrence.status === 'done' ? dimTowardPage(baseColor, DONE_DIM) : baseColor;

  return (
    <article
      className={`block block--${occurrence.status}`}
      onClick={(event) => {
        event.stopPropagation();
        onTap(occurrence);
      }}
      style={{
        top: minuteToPixel(startMinute),
        height: Math.max(minuteToPixel(durationMinutes), MIN_BLOCK_HEIGHT),
        background,
        color: readableTextColor(background),
      }}
    >
      <div className="block__text">
        <span className="block__title">{occurrence.title}</span>
        <span className="block__time">
          {formatTime(occurrence.displayStart)} - {formatTime(occurrence.displayEnd)}
        </span>
      </div>
    </article>
  );
}
