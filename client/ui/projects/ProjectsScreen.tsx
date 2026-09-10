import { formatDuration, totalsByProject } from '../../domain/summary';
import type { Project } from '../../domain/types';
import { useAppState } from '../../state/store';

type Props = {
  onEdit: (project: Project) => void;
};

export function ProjectsScreen({ onEdit }: Props) {
  const state = useAppState();
  const totals = totalsByProject(
    state.plans,
    state.overrides,
    state.projects,
    '0000-01-01',
    '9999-12-31',
  );
  const secondsById = new Map(
    totals.map((total) => [total.project?.id ?? null, total.seconds]),
  );

  if (state.projects.length === 0) {
    return <p className="placeholder">No projects yet. Use + to create one.</p>;
  }

  return (
    <ul className="list">
      {state.projects.map((project) => (
        <li key={project.id}>
          <button className="list__row" onClick={() => onEdit(project)}>
            <span className="dot" style={{ background: project.color }} />
            <span className="list__name">{project.name}</span>
            <span className="list__value">
              {formatDuration(secondsById.get(project.id) ?? 0)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
