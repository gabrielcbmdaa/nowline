import { useState } from 'react';
import { addWallClockMinutes } from '../../domain/dates';
import { RUNAWAY_TIMER_HOURS, correctTimes, runningHours } from '../../domain/timer';
import { reportError } from '../../reportError';
import { getRunningOverride, saveOverride, stopRunningTimer, useAppState } from '../../state/store';

type Props = {
  onFixTimes: (planId: string, date: string) => void;
};

/**
 * A timer nobody stopped would otherwise paint a block three days tall. This
 * points at the correction rather than guessing what really happened.
 */
export function RunawayTimerBanner({ onFixTimes }: Props) {
  const state = useAppState();
  const [dismissedTimer, setDismissedTimer] = useState<string | null>(null);

  const running = getRunningOverride(state);
  const timerKey = running ? `${running.id}:${running.actualStart}` : null;
  if (!running || dismissedTimer === timerKey) return null;
  if (runningHours(running, state.now) < RUNAWAY_TIMER_HOURS) return null;

  const plan = state.plans.find((candidate) => candidate.id === running.planId);
  if (!plan || !running.actualStart) return null;

  async function stopAtPlannedEnd() {
    if (!running?.actualStart || !plan) return;
    const durationMinutes = running.durationMinutes ?? plan.durationMinutes;
    const start = new Date(running.actualStart);
    // Where the calendar draws the planned end: marks of the grid after the
    // start. On the day the clocks go back that records the hour lived twice,
    // which is what the block then shows. A start in the second pass of that
    // hour whose planned end falls inside it gets an end at or before the
    // start; correctTimes refuses it, the error is reported, the banner stays.
    const end = addWallClockMinutes(start, durationMinutes);
    try {
      await saveOverride(correctTimes(running, start, end));
      setDismissedTimer(`${running.id}:${running.actualStart}`);
    } catch (error) {
      reportError('Stopping the runaway timer at its planned end failed', error);
      // Leave the banner up so a failed write does not hide a still-running timer.
    }
  }

  async function stopAndFixTimes() {
    if (!running) return;
    try {
      await stopRunningTimer();
      onFixTimes(running.planId, running.date);
    } catch (error) {
      reportError('Stopping the runaway timer failed', error);
      // Leave the banner up so a failed stop does not hide a still-running timer.
    }
  }

  return (
    <div className="banner" role="status">
      <span className="banner__text">
        “{plan.title}” has been running for over {RUNAWAY_TIMER_HOURS} hours.
      </span>
      <div className="banner__actions">
        <button
          className="button button--small"
          onClick={() => {
            void stopAtPlannedEnd();
          }}
        >
          Stop at planned end
        </button>
        <button
          className="button button--small"
          // Stops the timer before opening the editor, so cancelling the editor
          // cannot leave a running timer.
          onClick={() => {
            void stopAndFixTimes();
          }}
        >
          Stop and fix times
        </button>
        <button
          className="button button--small"
          onClick={() => setDismissedTimer(`${running.id}:${running.actualStart}`)}
          aria-label="Keep running"
        >
          Keep running
        </button>
      </div>
    </div>
  );
}
