import { useEffect } from 'react';
import { loadAll, setTab, startClock, useAppState } from '../state/store';
import { TopTabs } from './TopTabs';

export function App() {
  const state = useAppState();

  useEffect(() => {
    void loadAll();
    return startClock();
  }, []);

  if (!state.loaded) {
    return <div className="app app--loading">Loading…</div>;
  }

  return (
    <div className="app">
      <TopTabs active={state.tab} onChange={setTab} />
      <main className="screen">
        {state.tab === 'calendar' && <p className="placeholder">Calendar</p>}
        {state.tab === 'summary' && <p className="placeholder">Summary</p>}
        {state.tab === 'projects' && (
          <p className="placeholder">{state.projects.length} projects</p>
        )}
      </main>
    </div>
  );
}
