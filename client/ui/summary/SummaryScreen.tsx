import { addDays, startOfWeekKey, toDateKey } from '../../domain/dates';
import { formatDuration, totalsByProject } from '../../domain/summary';
import { useAppState } from '../../state/store';

export function SummaryScreen() {
  const state = useAppState();
  const today = toDateKey(state.now);
  const weekStart = startOfWeekKey(today);
  const weekEnd = addDays(weekStart, 6);

  // Today is inside the week, so the week rows are the full set of rows.
  const weekTotals = totalsByProject(
    state.plans,
    state.overrides,
    state.projects,
    weekStart,
    weekEnd,
  );
  const todaySeconds = new Map(
    totalsByProject(state.plans, state.overrides, state.projects, today, today).map(
      (total) => [total.project?.id ?? null, total.seconds],
    ),
  );

  if (weekTotals.length === 0) {
    return <p className="placeholder">Nothing tracked this week yet.</p>;
  }

  const weekSeconds = weekTotals.reduce((sum, total) => sum + total.seconds, 0);

  return (
    <div className="summary">
      <header className="summary__head">
        <span className="summary__spacer" />
        <span className="summary__column">Today</span>
        <span className="summary__column">Week</span>
      </header>

      <ul className="list">
        {weekTotals.map((total) => (
          <li key={total.project?.id ?? 'none'} className="list__row list__row--static">
            <span
              className="dot"
              style={{ background: total.project?.color ?? 'var(--no-project)' }}
            />
            <span className="list__name">{total.project?.name ?? 'No project'}</span>
            <span className="list__value">
              {formatDuration(todaySeconds.get(total.project?.id ?? null) ?? 0)}
            </span>
            <span className="list__value">{formatDuration(total.seconds)}</span>
          </li>
        ))}
      </ul>

      <footer className="summary__foot">
        <span className="list__name">Total this week</span>
        <span className="list__value">{formatDuration(weekSeconds)}</span>
      </footer>
    </div>
  );
}
