import { useState } from 'react';
import { PROJECT_COLORS, type Project } from '../../domain/types';
import { deleteProject, newId, saveProject, useAppState } from '../../state/store';
import { Sheet } from '../Sheet';

type Props = {
  project: Project | null;
  onClose: () => void;
};

export function ProjectEditorSheet({ project, onClose }: Props) {
  const state = useAppState();
  const [name, setName] = useState(project?.name ?? '');
  const [color, setColor] = useState(project?.color ?? PROJECT_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const affectedBlocks = project
    ? state.plans.filter((plan) => plan.projectId === project.id).length
    : 0;

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    void saveProject({
      id: project?.id ?? newId(),
      name: trimmed,
      color,
      createdAt: project?.createdAt ?? new Date().toISOString(),
    });
    onClose();
  }

  function handleDelete() {
    if (!project) return;
    void deleteProject(project.id);
    onClose();
  }

  return (
    <Sheet title={project ? 'Edit project' : 'New project'} onClose={onClose}>
      <label className="field">
        <span className="field__label">Name</span>
        <input
          className="field__input"
          value={name}
          autoFocus
          placeholder="Health"
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
        />
      </label>

      <div className="field">
        <span className="field__label">Color</span>
        <div className="swatches">
          {PROJECT_COLORS.map((option) => (
            <button
              key={option}
              className={`swatch ${option === color ? 'swatch--active' : ''}`}
              style={{ background: option }}
              aria-label={option}
              aria-pressed={option === color}
              onClick={() => setColor(option)}
            />
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="sheet__actions">
        {project && confirmingDelete ? (
          <>
            <button className="button" onClick={() => setConfirmingDelete(false)}>
              Cancel
            </button>
            <button className="button button--danger" onClick={handleDelete}>
              Delete
              {affectedBlocks > 0 && ` (${affectedBlocks} blocks keep no color)`}
            </button>
          </>
        ) : (
          <>
            {project && (
              <button className="button button--danger" onClick={() => setConfirmingDelete(true)}>
                Delete
              </button>
            )}
            <button className="button button--primary" onClick={handleSave}>
              Save
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
