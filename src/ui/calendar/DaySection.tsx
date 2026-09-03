import { DAY_HEIGHT, minuteToPixel } from '../../domain/geometry';
import type { ResolvedOccurrence } from '../../domain/types';
import { toDateKey } from '../../domain/dates';
import { formatDayHeading, formatHourLabel } from '../format';
import { NowLine } from './NowLine';
import { TimeBlockView } from './TimeBlockView';

/** 1 AM to 11 PM; midnight is marked by the day separator instead. */
const HOURS = Array.from({ length: 23 }, (_, index) => index + 1);

type Props = {
  date: string;
  occurrences: ResolvedOccurrence[];
  now: Date;
};

export function DaySection({ date, occurrences, now }: Props) {
  const isToday = date === toDateKey(now);

  return (
    <section className="day" style={{ height: DAY_HEIGHT }} data-date={date}>
      <div className="day__separator">
        <span className="day__label">{formatDayHeading(date, now)}</span>
      </div>

      {HOURS.map((hour) => (
        <div key={hour} className="hour-line" style={{ top: minuteToPixel(hour * 60) }}>
          <span className="hour-line__label">{formatHourLabel(hour)}</span>
        </div>
      ))}

      {occurrences.map((occurrence) => (
        <TimeBlockView key={occurrence.planId} occurrence={occurrence} />
      ))}

      {isToday && <NowLine now={now} date={date} />}
    </section>
  );
}
