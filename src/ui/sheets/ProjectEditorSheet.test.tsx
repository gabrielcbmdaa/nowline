// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repository } from '../../storage/repository';
import { getState, loadAll } from '../../state/store';
import { ProjectEditorSheet } from './ProjectEditorSheet';

function typeName(value: string): void {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
}

function clickSave(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('ProjectEditorSheet', () => {
  beforeEach(async () => {
    localStorage.clear();
    await loadAll();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('refuses a blank name and writes nothing', async () => {
    render(<ProjectEditorSheet project={null} onClose={() => {}} />);

    typeName('   ');
    clickSave();

    expect(await screen.findByText('Name is required')).toBeTruthy();
    expect(getState().projects).toEqual([]);
    expect(localStorage.getItem('tt.projects.v1')).toBeNull();
  });

  it('tells the user when the write fails, and stays open', async () => {
    // The failure is what is under test, so its report is expected output, not noise.
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(repository, 'saveProject').mockRejectedValue(new Error('storage is full'));
    const onClose = vi.fn();
    render(<ProjectEditorSheet project={null} onClose={onClose} />);

    typeName('Health');
    clickSave();

    expect(await screen.findByText('Could not save. Please try again.')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(reported).toHaveBeenCalledOnce();
  });

  it('saves a new project through the storage seam and closes', async () => {
    const onClose = vi.fn();
    render(<ProjectEditorSheet project={null} onClose={onClose} />);

    typeName('  Health  ');
    clickSave();

    await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(getState().projects.map((project) => project.name)).toEqual(['Health']);
    expect(await repository.listProjects()).toHaveLength(1);
  });
});
