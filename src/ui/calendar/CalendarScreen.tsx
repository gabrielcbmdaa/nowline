import { useLayoutEffect, useMemo, useState } from 'react';
import { minutesSinceMidnight, toDateKey } from '../../domain/dates';
import { indexOverrides, occurrencesForDay } from '../../domain/recurrence';
import { useAppState } from '../../state/store';
import { formatDayHeading } from '../format';
import { DatePickerSheet } from '../sheets/DatePickerSheet';
import { DaySection } from './DaySection';
import { useInfiniteDays } from './useInfiniteDays';

export function CalendarScreen() {
  const state = useAppState();
  const today = toDateKey(state.now);
  const { days, visibleDate, scrollRef, onScroll, goTo } = useInfiniteDays(today);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Layout effect, not effect: positioning after the first paint shows the top of
  // the window for one frame before jumping to now.
  useLayoutEffect(() => {
    // Open on the current time rather than at midnight.
    goTo(today, minutesSinceMidnight(state.now, today));
    // Only on mount: re-running this would yank the scroll out from under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overrideIndex = useMemo(
    () => indexOverrides(state.overrides),
    [state.overrides],
  );
  const projectsById = useMemo(
    () => new Map(state.projects.map((project) => [project.id, project])),
    [state.projects],
  );

  return (
    <div className="calendar">
      <header className="calendar__bar">
        <span className="calendar__date">{formatDayHeading(visibleDate, state.now)}</span>
        <button
          className="button button--small"
          onClick={() => goTo(toDateKey(state.now), minutesSinceMidnight(state.now, toDateKey(state.now)))}
        >
          Today
        </button>
        <button className="button button--small" onClick={() => setPickerOpen(true)}>
          Go to date
        </button>
      </header>

      <div className="calendar__scroll" ref={scrollRef} onScroll={onScroll}>
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

      {pickerOpen && (
        <DatePickerSheet
          initialDate={visibleDate}
          onClose={() => setPickerOpen(false)}
          onPick={(date) => {
            setPickerOpen(false);
            goTo(date, 8 * 60);
          }}
        />
      )}
    </div>
  );
}
