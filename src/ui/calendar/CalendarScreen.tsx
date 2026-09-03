import { useMemo, useRef, useState } from 'react';
import { addDays, toDateKey } from '../../domain/dates';
import { DAY_HEIGHT } from '../../domain/geometry';
import { indexOverrides, occurrencesForDay } from '../../domain/recurrence';
import { useAppState } from '../../state/store';
import { formatDayHeading } from '../format';
import { DaySection } from './DaySection';

/** Days kept mounted at once; 365 would be half a million pixels tall. */
export const WINDOW_DAYS = 7;

export function buildWindow(centerDate: string): string[] {
  const half = Math.floor(WINDOW_DAYS / 2);
  return Array.from({ length: WINDOW_DAYS }, (_, index) =>
    addDays(centerDate, index - half),
  );
}

export function CalendarScreen() {
  const state = useAppState();
  const today = toDateKey(state.now);
  const [days] = useState(() => buildWindow(today));
  const [visibleDate, setVisibleDate] = useState(today);
  const scrollRef = useRef<HTMLDivElement>(null);

  const overrideIndex = useMemo(
    () => indexOverrides(state.overrides),
    [state.overrides],
  );
  const projectsById = useMemo(
    () => new Map(state.projects.map((project) => [project.id, project])),
    [state.projects],
  );

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const index = Math.min(
      days.length - 1,
      Math.max(0, Math.floor((element.scrollTop + 1) / DAY_HEIGHT)),
    );
    if (days[index] !== visibleDate) setVisibleDate(days[index]);
  }

  return (
    <div className="calendar">
      <header className="calendar__bar">
        <span className="calendar__date">{formatDayHeading(visibleDate, state.now)}</span>
      </header>

      <div className="calendar__scroll" ref={scrollRef} onScroll={handleScroll}>
        {days.map((date) => (
          <DaySection
            key={date}
            date={date}
            now={state.now}
            occurrences={occurrencesForDay(
              state.plans,
              overrideIndex,
              projectsById,
              date,
              state.now,
            )}
          />
        ))}
      </div>
    </div>
  );
}
