import { useEffect, useState } from 'react';
import type { Project } from '../domain/types';
import { loadAll, setTab, startClock, useAppState } from '../state/store';
import { Fab } from './Fab';
import { TopTabs } from './TopTabs';
import { ProjectsScreen } from './projects/ProjectsScreen';
import { ProjectEditorSheet } from './sheets/ProjectEditorSheet';

type Sheet = { kind: 'project'; project: Project | null } | null;

export function App() {
  const state = useAppState();
  const [sheet, setSheet] = useState<Sheet>(null);

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
          <ProjectsScreen onEdit={(project) => setSheet({ kind: 'project', project })} />
        )}
      </main>

      <Fab
        actions={[
          {
            label: 'New project',
            onSelect: () => setSheet({ kind: 'project', project: null }),
          },
        ]}
      />

      {sheet?.kind === 'project' && (
        <ProjectEditorSheet project={sheet.project} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
