import { useState } from 'react';
import { RUNAWAY_TIMER_HOURS, correctTimes, runningHours } from '../../domain/timer';
import { getRunningOverride, saveOverride, useAppState } from '../../state/store';

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
    const end = new Date(start.getTime() + durationMinutes * 60000);
    try {
      await saveOverride(correctTimes(running, start, end));
      setDismissedTimer(`${running.id}:${running.actualStart}`);
    } catch {
      // Leave the banner up so a failed write does not hide a still-running timer.
    }
  }

  return (
    <div className="banner" role="status">
      <span className="banner__text">
        “{plan.title}” has been running for over {RUNAWAY_TIMER_HOURS} hours.
      </span>
      <div className="banner__actions">
        <button className="button button--small" onClick={stopAtPlannedEnd}>
          Stop at planned end
        </button>
        <button
          className="button button--small"
          // Deliberately does NOT dismiss: the user can still cancel the editor, and
          // the timer would then be running with its warning hidden for good.
          onClick={() => onFixTimes(running.planId, running.date)}
        >
          Fix end time
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
