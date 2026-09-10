import { useState } from 'react';
import { addDays, dateKeyToMidnight, toDateKey, weekdayOf } from '../../domain/dates';
import { MINUTES_PER_DAY } from '../../domain/geometry';
import { reportError } from '../../reportError';
import { formatDuration } from '../../domain/summary';
import { correctTimes, trackedSeconds } from '../../domain/timer';
import type { BlockPlan, Recurrence } from '../../domain/types';
import {
  deletePlan,
  newId,
  savePlan,
  saveOverride,
  useAppState,
} from '../../state/store';
import { Sheet } from '../Sheet';
import { minuteToTimeValue, timeValueToMinute } from '../format';

/**
 * The single letters fit seven buttons across a phone, but two of them read "T"
 * and two read "S", so the letter cannot be the name. The name carries the day.
 */
const WEEKDAYS = [
  { value: 1, label: 'M', name: 'Monday' },
  { value: 2, label: 'T', name: 'Tuesday' },
  { value: 3, label: 'W', name: 'Wednesday' },
  { value: 4, label: 'T', name: 'Thursday' },
  { value: 5, label: 'F', name: 'Friday' },
  { value: 6, label: 'S', name: 'Saturday' },
  { value: 0, label: 'S', name: 'Sunday' },
];

/** Hours and minutes of the local clock; seconds are not part of the field. */
function wallClockMinute(instant: Date): number {
  return instant.getHours() * 60 + instant.getMinutes();
}

/** Place a wall-clock minute on a calendar day, seconds cleared. */
function atWallClock(dateKey: string, minute: number): Date {
  const instant = dateKeyToMidnight(dateKey);
  instant.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return instant;
}

/**
 * Untouched fields keep the original instant, seconds included. Edited fields
 * are rebuilt from the typed wall clock; a tracked end at or before the start
 * clock lands on the following calendar day.
 */
function resolveTrackedTimestamps(
  actualStartIso: string,
  actualEndIso: string,
  startMinute: number,
  endMinute: number,
  startEdited: boolean,
  endEdited: boolean,
): { start: Date; end: Date } {
  const originalStart = new Date(actualStartIso);
  const originalEnd = new Date(actualEndIso);
  const start = startEdited
    ? atWallClock(toDateKey(originalStart), startMinute)
    : originalStart;
  const end = endEdited
    ? atWallClock(
        endMinute > startMinute ? toDateKey(start) : addDays(toDateKey(start), 1),
        endMinute,
      )
    : originalEnd;
  return { start, end };
}

type Props = {
  /** Null when creating a new block. */
  planId: string | null;
  date: string;
  defaultStartMinute: number;
  onClose: () => void;
};

export function BlockEditorSheet({ planId, date, defaultStartMinute, onClose }: Props) {
  const state = useAppState();
  const plan = planId ? state.plans.find((candidate) => candidate.id === planId) : null;

  const override = state.overrides.find(
    (candidate) => candidate.planId === planId && candidate.date === date,
  );
  const tracked = override?.status === 'done' ? override : null;

  const [title, setTitle] = useState(plan?.title ?? '');
  const [projectId, setProjectId] = useState<string | null>(plan?.projectId ?? null);
  const effectiveStartMinute =
    override?.startMinute ?? plan?.startMinute ?? defaultStartMinute;
  const [startMinute, setStartMinute] = useState(effectiveStartMinute);
  const [endMinute, setEndMinute] = useState(
    plan
      ? effectiveStartMinute + (override?.durationMinutes ?? plan.durationMinutes)
      : defaultStartMinute + 60,
  );
  const [recurrence, setRecurrence] = useState<Recurrence>(
    plan?.recurrence ?? { type: 'none' },
  );
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [trackedStart, setTrackedStart] = useState(() =>
    tracked?.actualStart ? wallClockMinute(new Date(tracked.actualStart)) : 0,
  );
  const [trackedEnd, setTrackedEnd] = useState(() =>
    tracked?.actualEnd ? wallClockMinute(new Date(tracked.actualEnd)) : 0,
  );
  const [trackedStartEdited, setTrackedStartEdited] = useState(false);
  const [trackedEndEdited, setTrackedEndEdited] = useState(false);

  const repeats = recurrence.type !== 'none';
  /** What is saved decides the delete scope; the draft may say something else. */
  const savedRepeats = (plan?.recurrence.type ?? 'none') !== 'none';

  const resolvedTracked =
    tracked?.actualStart &&
    tracked.actualEnd &&
    Number.isFinite(trackedStart) &&
    Number.isFinite(trackedEnd)
      ? resolveTrackedTimestamps(
          tracked.actualStart,
          tracked.actualEnd,
          trackedStart,
          trackedEnd,
          trackedStartEdited,
          trackedEndEdited,
        )
      : null;
  const trackedEndIsNextDay = resolvedTracked
    ? toDateKey(resolvedTracked.end) > toDateKey(resolvedTracked.start)
    : false;
  /**
   * `endMinute` counts from the start day's midnight and may pass 1440; the input
   * can only say "HH:MM". Same rule the tracked end above already uses: an end at
   * or before the start clock is the next day, which is the only reading that is
   * not a block of negative length.
   */
  const endIsNextDay = endMinute >= MINUTES_PER_DAY;
  function endMinuteFromField(value: string): number {
    const typed = timeValueToMinute(value);
    if (!Number.isFinite(typed)) return typed;
    if (typed > startMinute) return typed;
    // The same clock as the start is the one reading that means nothing: neither
    // a block of no length nor one of a whole day is what someone typing it meant.
    // Left as it is so the length check below refuses it and says so.
    if (typed === startMinute) return typed;
    return typed + MINUTES_PER_DAY;
  }

  function toggleWeekday(day: number) {
    setRecurrence((current) => {
      const weekdays = current.type === 'weekly' ? current.weekdays : [];
      return {
        type: 'weekly',
        weekdays: weekdays.includes(day)
          ? weekdays.filter((existing) => existing !== day)
          : [...weekdays, day].sort(),
      };
    });
  }

  async function handleSave() {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Title is required');
      return;
    }
    if (!Number.isFinite(startMinute) || !Number.isFinite(endMinute)) {
      setError('Enter a start time and an end time');
      return;
    }
    if (endMinute <= startMinute) {
      setError('End time must be after start time');
      return;
    }
    if (startMinute < 0 || startMinute >= MINUTES_PER_DAY) {
      setError('A block must start on the day it is placed on');
      return;
    }
    if (endMinute - startMinute > MINUTES_PER_DAY) {
      setError('A block cannot be longer than 24 hours');
      return;
    }
    if (recurrence.type === 'weekly' && recurrence.weekdays.length === 0) {
      setError('Pick at least one weekday');
      return;
    }

    if (tracked?.actualStart && tracked.actualEnd) {
      if (!Number.isFinite(trackedStart) || !Number.isFinite(trackedEnd)) {
        setError('Enter a start time and an end time');
        return;
      }
    }

    const now = new Date().toISOString();
    const next: BlockPlan = {
      id: plan?.id ?? newId(),
      title: trimmed,
      projectId,
      startMinute,
      durationMinutes: endMinute - startMinute,
      recurrence,
      // A block that does not repeat lives on the day it was placed on.
      anchorDate: recurrence.type === 'none' ? date : plan?.anchorDate ?? date,
      endDate: plan?.endDate ?? null,
      createdAt: plan?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
    };

    const hasPositionalOverride =
      override != null &&
      (override.startMinute != null || override.durationMinutes != null);

    try {
      if (tracked?.actualStart && tracked.actualEnd) {
        const { start, end } = resolveTrackedTimestamps(
          tracked.actualStart,
          tracked.actualEnd,
          trackedStart,
          trackedEnd,
          trackedStartEdited,
          trackedEndEdited,
        );
        const corrected = correctTimes(tracked, start, end);
        await saveOverride(
          hasPositionalOverride
            ? { ...corrected, startMinute: null, durationMinutes: null }
            : corrected,
        );
      } else if (override && hasPositionalOverride) {
        await saveOverride({
          id: override.id,
          planId: override.planId,
          date: override.date,
          status: override.status,
          actualStart: override.actualStart,
          actualEnd: override.actualEnd,
          startMinute: null,
          durationMinutes: null,
          updatedAt: now,
        });
      }
      await savePlan(next);
      onClose();
    } catch (saveError) {
      const message = (saveError as Error).message;
      // Validation is an answer, not a defect: only the other half is worth reporting.
      const isValidation = message === 'End time must be after start time';
      if (!isValidation) reportError('Saving the block failed', saveError);
      setError(isValidation ? message : 'Could not save. Please try again.');
    }
  }

  async function deleteThisDay() {
    if (!plan) return;
    const existing = state.overrides.find(
      (override) => override.planId === plan.id && override.date === date,
    );
    try {
      await saveOverride({
        id: existing?.id ?? newId(),
        planId: plan.id,
        date,
        status: 'deleted',
        actualStart: null,
        actualEnd: null,
        startMinute: null,
        durationMinutes: null,
        updatedAt: new Date().toISOString(),
      });
      onClose();
    } catch (error) {
      reportError('Deleting this day of the block failed', error);
      setError('Could not delete. Please try again.');
    }
  }

  async function deleteAllDays() {
    if (!plan) return;
    try {
      await deletePlan(plan.id);
      onClose();
    } catch (error) {
      reportError('Deleting every day of the block failed', error);
      setError('Could not delete. Please try again.');
    }
  }

  let trackedPreviewLabel = 'Tracked time';
  if (
    tracked &&
    resolvedTracked &&
    resolvedTracked.end.getTime() > resolvedTracked.start.getTime()
  ) {
    trackedPreviewLabel = `Tracked time — ${formatDuration(
      trackedSeconds({
        ...tracked,
        actualStart: resolvedTracked.start.toISOString(),
        actualEnd: resolvedTracked.end.toISOString(),
      }),
    )}`;
  }

  return (
    <Sheet title={plan ? 'Edit time block' : 'New time block'} onClose={onClose}>
      <label className="field">
        <span className="field__label">Title</span>
        {/* No autoFocus: on a phone it raises the keyboard over the whole sheet.
            The Sheet still traps focus, landing it on the close button instead. */}
        <input
          className="field__input"
          value={title}
          placeholder="Make exercise"
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
        />
      </label>

      <label className="field">
        <span className="field__label">Project</span>
        <select
          className="field__select"
          value={projectId ?? ''}
          onChange={(event) => setProjectId(event.target.value || null)}
        >
          <option value="">No project</option>
          {state.projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      <div className="field field--row">
        <label className="field">
          <span className="field__label">Start</span>
          <input
            className="field__input"
            type="time"
            value={minuteToTimeValue(startMinute)}
            onChange={(event) => {
              setStartMinute(timeValueToMinute(event.target.value));
              setError(null);
            }}
          />
        </label>
        <label className="field">
          <span className="field__label">End{endIsNextDay ? ' next day' : ''}</span>
          <input
            className="field__input"
            type="time"
            value={minuteToTimeValue(endMinute % MINUTES_PER_DAY)}
            onChange={(event) => {
              setEndMinute(endMinuteFromField(event.target.value));
              setError(null);
            }}
          />
        </label>
      </div>

      <div className="field">
        <span className="field__label">Repeat</span>
        <div className="choices">
          <button
            className={`choice ${recurrence.type === 'none' ? 'choice--active' : ''}`}
            onClick={() => setRecurrence({ type: 'none' })}
          >
            Does not repeat
          </button>
          <button
            className={`choice ${recurrence.type === 'daily' ? 'choice--active' : ''}`}
            onClick={() => setRecurrence({ type: 'daily' })}
          >
            Every day
          </button>
          <button
            className={`choice ${recurrence.type === 'weekly' ? 'choice--active' : ''}`}
            onClick={() =>
              setRecurrence({ type: 'weekly', weekdays: [weekdayOf(date)] })
            }
          >
            Weekly
          </button>
        </div>
        {repeats && recurrence.type === 'weekly' && (
          <div className="choices">
            {WEEKDAYS.map((weekday) => (
              <button
                key={weekday.value}
                className={`choice choice--round ${
                  recurrence.weekdays.includes(weekday.value) ? 'choice--active' : ''
                }`}
                aria-label={weekday.name}
                aria-pressed={recurrence.weekdays.includes(weekday.value)}
                onClick={() => toggleWeekday(weekday.value)}
              >
                {weekday.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {tracked && (
        <div className="field">
          <span className="field__label">{trackedPreviewLabel}</span>
          <div className="field--row">
            <label className="field">
              <span className="field__label">Started</span>
              <input
                className="field__input"
                type="time"
                value={minuteToTimeValue(trackedStart)}
                onChange={(event) => {
                  setTrackedStart(timeValueToMinute(event.target.value));
                  setTrackedStartEdited(true);
                  setError(null);
                }}
              />
            </label>
            <label className="field">
              <span className="field__label">
                Ended{trackedEndIsNextDay ? ' next day' : ''}
              </span>
              <input
                className="field__input"
                type="time"
                value={minuteToTimeValue(trackedEnd)}
                onChange={(event) => {
                  setTrackedEnd(timeValueToMinute(event.target.value));
                  setTrackedEndEdited(true);
                  setError(null);
                }}
              />
            </label>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {confirmingDelete ? (
        <div className="sheet__actions">
          <button className="button" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
          <button className="button button--danger" onClick={() => { void deleteThisDay(); }}>
            This day
          </button>
          <button className="button button--danger" onClick={() => { void deleteAllDays(); }}>
            All days
          </button>
        </div>
      ) : (
        <div className="sheet__actions">
          {plan && (
            <button
              className="button button--danger"
              onClick={() => (savedRepeats ? setConfirmingDelete(true) : void deleteAllDays())}
            >
              Delete
            </button>
          )}
          <button className="button button--primary" onClick={() => { void handleSave(); }}>
            Save
          </button>
        </div>
      )}
    </Sheet>
  );
}
