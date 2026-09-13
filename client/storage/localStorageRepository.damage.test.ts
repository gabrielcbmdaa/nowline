// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Project } from '../domain/types';

vi.mock('../reportError', () => ({
  reportError: vi.fn(),
  reportWarning: vi.fn(),
}));

import { reportWarning } from '../reportError';
import { LocalStorageRepository } from './localStorageRepository';

const warned = reportWarning as Mock;
const KEY = 'nowline.projects.v2';

const project: Project = {
  id: 'health',
  name: 'Health',
  color: '#E5484D',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  deletedAt: null,
};

/** A blob whose second row has a number for an id: readable around the damage. */
const partlyDamaged = JSON.stringify([project, { ...project, id: 123, name: 'Broken' }]);

function throwWhenWriting(keyToThrow: string) {
  const original = Storage.prototype.setItem;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key === keyToThrow) throw new Error('quota exceeded');
    return original.call(this, key, value);
  });
}

function storedIds(key: string): string[] {
  const rows = JSON.parse(localStorage.getItem(key) ?? 'null') as { id: string }[];
  return rows.map((row) => row.id);
}

describe('reading damaged storage', () => {
  beforeEach(() => {
    localStorage.clear();
    warned.mockClear();
  });

  it('says nothing about a key that does not exist', async () => {
    expect(await new LocalStorageRepository().listProjects()).toEqual([]);
    expect(warned).not.toHaveBeenCalled();
  });

  it('reports a key that is present but empty, which the app never writes', async () => {
    // `write` always stores at least `[]`; an empty string is a truncated write,
    // the same reading `readPending` already gives it. Named as such: a parse
    // failure would also be reported, but would send the reader after garbage.
    localStorage.setItem(KEY, '');
    expect(await new LocalStorageRepository().listProjects()).toEqual([]);
    expect(warned).toHaveBeenCalledOnce();
    expect(warned.mock.calls[0][0]).toBe(`Stored "${KEY}" is empty`);
  });

  it('reports JSON that is not an array', async () => {
    localStorage.setItem(KEY, '{"id":"health"}');
    expect(await new LocalStorageRepository().listProjects()).toEqual([]);
    expect(warned).toHaveBeenCalledOnce();
    expect(warned.mock.calls[0][0]).toBe(`Stored "${KEY}" is not an array`);
  });

  it('reports the rows it drops, and still returns the ones it can read', async () => {
    localStorage.setItem(KEY, partlyDamaged);
    expect(await new LocalStorageRepository().listProjects()).toEqual([project]);
    expect(warned).toHaveBeenCalledOnce();
    // The count is what tells the next reader how much is missing.
    expect(warned.mock.calls[0][0]).toBe(`Stored "${KEY}" holds 1 row(s) without a string id`);
  });
});

describe('writing over damaged storage', () => {
  beforeEach(() => {
    localStorage.clear();
    warned.mockClear();
  });

  it('quarantines an empty string before the first save overwrites it', async () => {
    localStorage.setItem(KEY, '');
    await new LocalStorageRepository().saveProject(project);

    expect(localStorage.getItem(`${KEY}.corrupt`)).toBe('');
    expect(storedIds(KEY)).toEqual(['health']);
  });

  it('quarantines a blob that is not an array before the first save overwrites it', async () => {
    const damaged = '{"id":"health"}';
    localStorage.setItem(KEY, damaged);
    await new LocalStorageRepository().saveProject(project);

    expect(localStorage.getItem(`${KEY}.corrupt`)).toBe(damaged);
    expect(storedIds(KEY)).toEqual(['health']);
    expect(warned.mock.calls).toContainEqual([
      `Quarantined the damaged "${KEY}" under "${KEY}.corrupt"`,
      damaged.length,
    ]);
  });

  it('keeps the readable rows and quarantines the whole blob they came from', async () => {
    localStorage.setItem(KEY, partlyDamaged);
    await new LocalStorageRepository().saveProject({ ...project, id: 'work', name: 'Work' });

    expect(localStorage.getItem(`${KEY}.corrupt`)).toBe(partlyDamaged);
    expect(storedIds(KEY)).toEqual(['health', 'work']);
  });

  it('does not quarantine the same string twice', async () => {
    localStorage.setItem(`${KEY}.corrupt`, 'not json at all');
    localStorage.setItem(KEY, 'not json at all');
    await new LocalStorageRepository().saveProject(project);

    expect(localStorage.getItem(`${KEY}.corrupt`)).toBe('not json at all');
    expect(localStorage.getItem(`${KEY}.corrupt.2`)).toBeNull();
  });

  it('never overwrites an earlier quarantine: a different blob goes to .corrupt.2', async () => {
    localStorage.setItem(`${KEY}.corrupt`, 'the first damage');
    localStorage.setItem(KEY, 'the second damage');
    await new LocalStorageRepository().saveProject(project);

    expect(localStorage.getItem(`${KEY}.corrupt`)).toBe('the first damage');
    expect(localStorage.getItem(`${KEY}.corrupt.2`)).toBe('the second damage');
  });

  it('refuses to overwrite when the quarantine itself cannot be written', async () => {
    localStorage.setItem(KEY, 'not json at all');
    const spy = throwWhenWriting(`${KEY}.corrupt`);
    try {
      await expect(new LocalStorageRepository().saveProject(project)).rejects.toThrow('quota exceeded');
      // Byte for byte: the save failed loudly instead of the rows dying quietly.
      expect(localStorage.getItem(KEY)).toBe('not json at all');
    } finally {
      spy.mockRestore();
    }
  });

  it('quarantines before the cloud replaces everything on a first sync', async () => {
    localStorage.setItem(KEY, 'not json at all');
    await new LocalStorageRepository().replaceAllFromServer({
      projects: [{ id: 'from-cloud', updatedAt: '2026-09-10T00:00:00.000Z' }],
      plans: [],
      overrides: [],
    });

    expect(localStorage.getItem(`${KEY}.corrupt`)).toBe('not json at all');
    expect(storedIds(KEY)).toEqual(['from-cloud']);
  });
});
