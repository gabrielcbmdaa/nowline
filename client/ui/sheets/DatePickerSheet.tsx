import { useState } from 'react';
import { addDays, dateKeyToMidnight, startOfWeekKey, toDateKey } from '../../domain/dates';
import { Sheet } from '../Sheet';

const WEEKDAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Six Monday-based weeks always cover any month. */
export function monthGrid(monthAnchor: string): string[] {
  const date = dateKeyToMidnight(monthAnchor);
  const firstOfMonth = toDateKey(new Date(date.getFullYear(), date.getMonth(), 1));
  const start = startOfWeekKey(firstOfMonth);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

type Props = {
  initialDate: string;
  onPick: (date: string) => void;
  onClose: () => void;
};

export function DatePickerSheet({ initialDate, onPick, onClose }: Props) {
  const [monthAnchor, setMonthAnchor] = useState(initialDate);
  const anchorDate = dateKeyToMidnight(monthAnchor);
  const anchorMonth = anchorDate.getMonth();

  function shiftMonth(delta: number) {
    const shifted = new Date(anchorDate.getFullYear(), anchorMonth + delta, 1);
    setMonthAnchor(toDateKey(shifted));
  }

  return (
    <Sheet title="Go to date" onClose={onClose}>
      <div className="month__header">
        <button
          className="button button--small"
          aria-label="Previous month"
          onClick={() => shiftMonth(-1)}
        >
          ‹
        </button>
        <span className="month__name">
          {anchorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        </span>
        <button
          className="button button--small"
          aria-label="Next month"
          onClick={() => shiftMonth(1)}
        >
          ›
        </button>
      </div>

      <div className="month__grid">
        {WEEKDAY_LABELS.map((label, index) => (
          <span key={index} className="month__weekday">
            {label}
          </span>
        ))}
        {monthGrid(monthAnchor).map((day) => {
          const cellDate = dateKeyToMidnight(day);
          const inMonth = cellDate.getMonth() === anchorMonth;
          return (
            <button
              key={day}
              className={`month__day ${inMonth ? '' : 'month__day--outside'} ${
                day === initialDate ? 'month__day--current' : ''
              }`}
              aria-label={cellDate.toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              /* "true", not "date": this cell marks the day being viewed, which is
                 often not today, and "date" specifically means today. */
              aria-current={day === initialDate ? 'true' : undefined}
              onClick={() => onPick(day)}
            >
              {cellDate.getDate()}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}
