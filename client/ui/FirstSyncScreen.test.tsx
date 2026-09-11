// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sync from '../storage/sync';
import { FirstSyncScreen } from './FirstSyncScreen';

function clickButton(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('FirstSyncScreen', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows both counts, because the choice is between them', () => {
    render(<FirstSyncScreen local={34} remote={120} onSettled={vi.fn()} />);
    // The order matters as much as the numbers: swapped, the owner would read
    // that the cloud holds his 34 and choose accordingly.
    expect(screen.getByText(/this device has 34 .*the cloud has 120/i)).toBeTruthy();
  });

  it('carries out the choice the owner made', async () => {
    const settle = vi.spyOn(sync, 'settleFirstSync').mockResolvedValue({ kind: 'done', downloaded: 0, stillOwed: 0 });
    const onSettled = vi.fn();
    render(<FirstSyncScreen local={34} remote={120} onSettled={onSettled} />);

    clickButton(/keep mine/i);
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalled());

    expect(settle).toHaveBeenCalledWith('upload-mine');
    expect(onSettled).toHaveBeenCalled();
  });

  it('asks the owner to confirm before throwing his own rows away', async () => {
    const settle = vi.spyOn(sync, 'settleFirstSync');
    render(<FirstSyncScreen local={34} remote={120} onSettled={vi.fn()} />);

    clickButton(/take the cloud/i);

    // One tap must not be enough to discard 34 blocks. A copy is kept, but it
    // is under a key nothing in the app reads, and the owner's real data lives
    // on a phone with no console to dig it out of.
    expect(settle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /yes, replace/i })).toBeTruthy();
  });

  it('stays put and says why when the round did not go through', async () => {
    vi.spyOn(sync, 'settleFirstSync').mockResolvedValue({ kind: 'offline' });
    const onSettled = vi.fn();
    render(<FirstSyncScreen local={34} remote={120} onSettled={onSettled} />);

    clickButton(/keep mine/i);
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeTruthy());

    // Moving on would leave a device that never joined looking like one that
    // did, and the question would come back on the next boot with no warning.
    expect(onSettled).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/no answer|connection/i);
  });

  it('does not send a second choice while the first is being carried out', async () => {
    let release: (value: { kind: 'done'; downloaded: number; stillOwed: number }) => void = () => {};
    const settle = vi.spyOn(sync, 'settleFirstSync').mockReturnValue(new Promise((resolve) => { release = resolve; }));
    render(<FirstSyncScreen local={34} remote={120} onSettled={vi.fn()} />);

    clickButton(/keep mine/i);

    // While the choice is being carried out, every button says no — including
    // the one that opens the confirmation, or a "take the cloud" could run
    // right after a "keep mine" finished.
    for (const button of screen.getAllByRole('button')) {
      if (!(button instanceof HTMLButtonElement)) throw new Error('expected a button');
      expect(button.disabled).toBe(true);
    }
    clickButton(/keep mine|working/i);
    clickButton(/take the cloud/i);
    expect(screen.queryByRole('button', { name: /yes, replace/i })).toBeNull();
    expect(settle).toHaveBeenCalledTimes(1);
    release({ kind: 'done', downloaded: 0, stillOwed: 0 });
  });

  it('replaces mine only after the second tap, and with the right choice', async () => {
    const settle = vi.spyOn(sync, 'settleFirstSync').mockResolvedValue({ kind: 'done', downloaded: 120, stillOwed: 0 });
    const onSettled = vi.fn();
    render(<FirstSyncScreen local={34} remote={120} onSettled={onSettled} />);

    clickButton(/take the cloud/i);
    clickButton(/yes, replace/i);
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalled());

    // The confirmation button is the one that discards rows; sending
    // 'upload-mine' from it would keep everything and tell the owner it did
    // the opposite.
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith('take-the-cloud');
  });
});
