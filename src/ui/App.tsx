import { useEffect, useState } from 'react';
import { minutesSinceMidnight, toDateKey } from '../domain/dates';
import { floorToQuarterHour } from '../domain/geometry';
import type { Project } from '../domain/types';
import { loadAll, setTab, startClock, useAppState } from '../state/store';
import { Fab } from './Fab';
import { TopTabs } from './TopTabs';
import { CalendarScreen } from './calendar/CalendarScreen';
import { RunawayTimerBanner } from './calendar/RunawayTimerBanner';
import { ProjectsScreen } from './projects/ProjectsScreen';
import { BlockEditorSheet } from './sheets/BlockEditorSheet';
import { ProjectEditorSheet } from './sheets/ProjectEditorSheet';
import { SummaryScreen } from './summary/SummaryScreen';

type Sheet =
  | { kind: 'project'; project: Project | null }
  | { kind: 'block'; planId: string | null; date: string; startMinute: number }
  | null;

/** Where a new block lands on a day whose current time is meaningless. */
const DEFAULT_NEW_BLOCK_MINUTE = 9 * 60;

export function App() {
  const state = useAppState();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    void loadAll().catch(() => setLoadError(true));
    return startClock();
  }, []);

  if (!state.loaded) {
    if (loadError) {
      return (
        <div className="app app--loading">
          <p className="error">Could not load. Please try again.</p>
          <button
            className="button"
            onClick={() => {
              setLoadError(false);
              void loadAll().catch(() => setLoadError(true));
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return <div className="app app--loading">Loading…</div>;
  }

  /**
   * Read at tap time, not from the 30-second clock tick: just after midnight a stale
   * tick would open tomorrow's block on yesterday.
   */
  function newBlockTarget(): { date: string; startMinute: number } {
    const now = new Date();
    const today = toDateKey(now);
    const date = state.tab === 'calendar' ? state.visibleDate : today;
    return {
      date,
      startMinute:
        date === today
          ? floorToQuarterHour(minutesSinceMidnight(now, date))
          : DEFAULT_NEW_BLOCK_MINUTE,
    };
  }

  return (
    <div className="app">
      <TopTabs active={state.tab} onChange={setTab} />
      <main className="screen">
        {state.tab === 'calendar' && (
          <div className="tab-pane">
            <RunawayTimerBanner
              onFixTimes={(planId, date) =>
                setSheet({ kind: 'block', planId, date, startMinute: 0 })
              }
            />
            <CalendarScreen
              onCreateBlock={(date, startMinute) =>
                setSheet({ kind: 'block', planId: null, date, startMinute })
              }
              onEditBlock={(planId, date) =>
                setSheet({ kind: 'block', planId, date, startMinute: 0 })
              }
            />
          </div>
        )}
        {state.tab === 'summary' && <SummaryScreen />}
        {state.tab === 'projects' && (
          <ProjectsScreen onEdit={(project) => setSheet({ kind: 'project', project })} />
        )}
      </main>

      <Fab
        actions={[
          {
            label: 'New time block',
            onSelect: () => {
              const target = newBlockTarget();
              setSheet({
                kind: 'block',
                planId: null,
                date: target.date,
                startMinute: target.startMinute,
              });
            },
          },
          {
            label: 'New project',
            onSelect: () => setSheet({ kind: 'project', project: null }),
          },
        ]}
      />

      {sheet?.kind === 'block' && (
        <BlockEditorSheet
          planId={sheet.planId}
          date={sheet.date}
          defaultStartMinute={sheet.startMinute}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet?.kind === 'project' && (
        <ProjectEditorSheet project={sheet.project} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
