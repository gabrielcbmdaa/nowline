import { clampMinute, dayHeight, floorToQuarterHour, minuteToPixel, pixelToMinute } from '../../domain/geometry';
import type { ResolvedOccurrence } from '../../domain/types';
import { toDateKey } from '../../domain/dates';
import { formatDayGutterHeading, formatHourLabel } from '../format';
import { NowLine } from './NowLine';
import { TimeBlockView } from './TimeBlockView';

/** 1 AM to 11 PM; midnight is marked by the day separator instead. */
const HOURS = Array.from({ length: 23 }, (_, index) => index + 1);

type Props = {
  date: string;
  pixelsPerHour: number;
  occurrences: ResolvedOccurrence[];
  now: Date;
  onBackgroundTap: (date: string, minute: number) => void;
  onOccurrenceTap: (occurrence: ResolvedOccurrence) => void;
  onToggleTimer: (occurrence: ResolvedOccurrence) => void;
};

export function DaySection({
  date,
  pixelsPerHour,
  occurrences,
  now,
  onBackgroundTap,
  onOccurrenceTap,
  onToggleTimer,
}: Props) {
  const isToday = date === toDateKey(now);
  const gutterHeading = formatDayGutterHeading(date, now);

  return (
    <section
      className="day"
      style={{ height: dayHeight(pixelsPerHour) }}
      data-date={date}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const minute = pixelToMinute(event.clientY - bounds.top, pixelsPerHour);
        // Flooring keeps the new block from starting above the finger.
        onBackgroundTap(date, clampMinute(floorToQuarterHour(minute)));
      }}
    >
      <div className="day__separator">
        <span className="day__label">
          <span className="day__label-line">{gutterHeading.weekday}</span>
          {gutterHeading.monthDay !== null && (
            <span className="day__label-line">{gutterHeading.monthDay}</span>
          )}
        </span>
      </div>

      {HOURS.map((hour) => (
        <div key={hour} className="hour-line" style={{ top: minuteToPixel(hour * 60, pixelsPerHour) }}>
          <span className="hour-line__label">{formatHourLabel(hour)}</span>
        </div>
      ))}

      {occurrences.map((occurrence) => (
        <TimeBlockView
          key={occurrence.planId}
          occurrence={occurrence}
          isToday={isToday}
          pixelsPerHour={pixelsPerHour}
          onTap={onOccurrenceTap}
          onToggleTimer={onToggleTimer}
        />
      ))}

      {isToday && <NowLine now={now} date={date} pixelsPerHour={pixelsPerHour} />}
    </section>
  );
}
