import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { minutesSinceMidnight, toDateKey } from '../../domain/dates';
import { DEFAULT_PIXELS_PER_HOUR } from '../../domain/geometry';
import { steppedScale, wheelScale } from '../../domain/zoom';
import { indexOverrides, occurrencesForDay } from '../../domain/recurrence';
import { reportError } from '../../reportError';
import { getState, startTimerFor, stopRunningTimer, useAppState } from '../../state/store';
import { formatDayHeading } from '../format';
import { DatePickerSheet } from '../sheets/DatePickerSheet';
import { DaySection } from './DaySection';
import { useInfiniteDays } from './useInfiniteDays';

type Props = {
  onCreateBlock: (date: string, minute: number) => void;
  onEditBlock: (planId: string, date: string) => void;
};

export function CalendarScreen({ onCreateBlock, onEditBlock }: Props) {
  const state = useAppState();
  const today = toDateKey(state.now);
  const {
    days,
    visibleDate,
    scrollRef,
    onScroll,
    goTo,
    zoomTo,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  } = useInfiniteDays(today, state.pixelsPerHour);
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

  // Not React's onWheel: React 19 registers it passive, and a passive listener
  // cannot cancel the browser's own page zoom. Without preventDefault, Ctrl
  // plus wheel would zoom the page and the calendar at the same time.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const el = scrollRef.current;
      if (!el) return;
      // deltaMode 1 is lines and 2 is pages; Firefox sends both. Unnormalised,
      // a deltaY of 3 lines would read as 3 pixels and the wheel would do
      // almost nothing.
      const LINE_HEIGHT = 16;
      const factor =
        event.deltaMode === 1 ? LINE_HEIGHT : event.deltaMode === 2 ? el.clientHeight : 1;
      const bounds = el.getBoundingClientRect();
      zoomTo(
        wheelScale(getState().pixelsPerHour, event.deltaY * factor),
        event.clientY - bounds.top,
      );
    }

    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [zoomTo, scrollRef]);

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

      {/* The block's begin() stops the bubble, so the first finger would never join the
          pinch map; capture still sees it because this node is an ancestor of the block. */}
      <div
        className="calendar__scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDownCapture={onPointerDown}
        onPointerMoveCapture={onPointerMove}
        onPointerUpCapture={onPointerUp}
        onPointerCancelCapture={onPointerCancel}
        tabIndex={0}
        onKeyDown={(event) => {
          // On the container and not on the document: Sheet's own listener only
          // acts on Escape and Tab and lets the rest through, so a document
          // listener would zoom behind the editor while a title with a `+` is
          // being typed.
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === '+' || event.key === '=') {
            event.preventDefault();
            zoomTo(steppedScale(state.pixelsPerHour, 1), null);
            return;
          }
          if (event.key === '-') {
            event.preventDefault();
            zoomTo(steppedScale(state.pixelsPerHour, -1), null);
            return;
          }
          if (event.key === '0') {
            event.preventDefault();
            zoomTo(DEFAULT_PIXELS_PER_HOUR, null);
          }
        }}
      >
        {days.map((date) => (
          <DaySection
            key={date}
            date={date}
            pixelsPerHour={state.pixelsPerHour}
            now={state.now}
            onBackgroundTap={onCreateBlock}
            onOccurrenceTap={(occurrence) =>
              onEditBlock(occurrence.planId, occurrence.date)
            }
            onToggleTimer={(occurrence) => {
              void (async () => {
                try {
                  if (occurrence.status === 'running') {
                    await stopRunningTimer();
                    return;
                  }
                  // The button is hidden off today, but state.now only ticks every 30
                  // seconds, so just after midnight it can still be showing on yesterday.
                  // Check the real clock before writing today's timestamp to a past day.
                  if (occurrence.date !== toDateKey(new Date())) return;
                  await startTimerFor(occurrence.planId, occurrence.date);
                } catch (error) {
                  reportError('Toggling the timer failed', error);
                  // A failed start or stop leaves the calendar as it was.
                }
              })();
            }}
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
