// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as sync from '../storage/sync';
import { CONFIRM_ARMS_AFTER_MS, FirstSyncScreen } from './FirstSyncScreen';

function clickButton(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

describe('FirstSyncScreen', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows both counts, because the choice is between them', () => {
    render(<FirstSyncScreen local={34} remote={120} onSettled={vi.fn()} onSignedOut={vi.fn()} />);
    // The order matters as much as the numbers: swapped, the owner would read
    // that the cloud holds his 34 and choose accordingly.
    expect(screen.getByText(/this device has 34 .*the cloud has 120/i)).toBeTruthy();
  });

  it('carries out the choice the owner made', async () => {
    const settle = vi.spyOn(sync, 'settleFirstSync').mockResolvedValue({ kind: 'done', downloaded: 0, stillOwed: 0 });
    const onSettled = vi.fn();
    render(<FirstSyncScreen local={34} remote={120} onSettled={onSettled} onSignedOut={vi.fn()} />);

    clickButton(/upload mine/i);
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalled());

    expect(settle).toHaveBeenCalledWith('upload-mine');
    expect(onSettled).toHaveBeenCalled();
  });

  it('asks the owner to confirm before throwing his own rows away', async () => {
    const settle = vi.spyOn(sync, 'settleFirstSync');
    render(<FirstSyncScreen local={34} remote={120} onSettled={vi.fn()} onSignedOut={vi.fn()} />);

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
    render(<FirstSyncScreen local={34} remote={120} onSettled={onSettled} onSignedOut={vi.fn()} />);

    clickButton(/upload mine/i);
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeTruthy());

    // Moving on would leave a device that never joined looking like one that
    // did, and the question would come back on the next boot with no warning.
    expect(onSettled).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/no answer|connection/i);
  });

  it('does not send a second choice while the first is being carried out', async () => {
    let release: (value: { kind: 'done'; downloaded: number; stillOwed: number }) => void = () => {};
    const settle = vi.spyOn(sync, 'settleFirstSync').mockReturnValue(new Promise((resolve) => { release = resolve; }));
    render(<FirstSyncScreen local={34} remote={120} onSettled={vi.fn()} onSignedOut={vi.fn()} />);

    clickButton(/upload mine/i);

    // While the choice is being carried out, every button says no — including
    // the one that opens the confirmation, or a "take the cloud" could run
    // right after a "keep mine" finished.
    for (const button of screen.getAllByRole('button')) {
      if (!(button instanceof HTMLButtonElement)) throw new Error('expected a button');
      expect(button.disabled).toBe(true);
    }
    clickButton(/upload mine|working/i);
    clickButton(/take the cloud/i);
    expect(screen.queryByRole('button', { name: /yes, replace/i })).toBeNull();
    expect(settle).toHaveBeenCalledTimes(1);
    release({ kind: 'done', downloaded: 0, stillOwed: 0 });
  });

  it('replaces mine only after the second tap, and with the right choice', async () => {
    vi.useFakeTimers();
    const settle = vi.spyOn(sync, 'settleFirstSync').mockResolvedValue({ kind: 'done', downloaded: 120, stillOwed: 0 });
    const onSettled = vi.fn();
    render(<FirstSyncScreen local={34} remote={120} onSettled={onSettled} onSignedOut={vi.fn()} />);

    clickButton(/take the cloud/i);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRM_ARMS_AFTER_MS);
    });
    clickButton(/yes, replace/i);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    // The confirmation button is the one that discards rows; sending
    // 'upload-mine' from it would keep everything and tell the owner it did
    // the opposite.
    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle).toHaveBeenCalledWith('take-the-cloud');
    expect(onSettled).toHaveBeenCalled();
  });

  it('does not let a double tap confirm the replace', async () => {
    vi.useFakeTimers();
    const settle = vi.spyOn(sync, 'settleFirstSync');
    render(<FirstSyncScreen local={1} remote={7} onSettled={vi.fn()} onSignedOut={vi.fn()} />);

    clickButton(/take the cloud/i);
    // The second tap of a double tap lands where the first did, a few tens of
    // milliseconds later. Whatever is there must do nothing.
    const confirm = screen.getByRole('button', { name: /yes, replace/i });
    if (!(confirm instanceof HTMLButtonElement)) throw new Error('expected a button');
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRM_ARMS_AFTER_MS - 1);
    });
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(confirm.disabled).toBe(false);

    expect(settle).not.toHaveBeenCalled();
  });

  it('says what the replace would do, with the real numbers', () => {
    render(<FirstSyncScreen local={1} remote={7} onSettled={vi.fn()} onSignedOut={vi.fn()} />);

    clickButton(/take the cloud/i);

    // The sentence is the confirmation; a bare "are you sure" tells the owner
    // nothing about what is about to be thrown away.
    const sentence = screen.getByText(/replaces the 1 block on this device with the cloud's 7/i);
    expect(sentence).toBeTruthy();
    expect(screen.getByText(/copy stays on this device/i)).toBeTruthy();
    const row = sentence.closest('.gate')?.querySelector('.gate__actions');
    if (!(row instanceof HTMLElement)) throw new Error('expected .gate__actions');
    // A paragraph above the row pushes the buttons down and the finger misses Cancel.
    expect(row.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clears the arm timeout when the owner cancels before it fires', async () => {
    vi.useFakeTimers();
    render(<FirstSyncScreen local={1} remote={7} onSettled={vi.fn()} onSignedOut={vi.fn()} />);

    clickButton(/take the cloud/i);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRM_ARMS_AFTER_MS - 1);
    });
    clickButton(/cancel/i);
    clickButton(/take the cloud/i);
    const confirm = screen.getByRole('button', { name: /yes, replace/i });
    if (!(confirm instanceof HTMLButtonElement)) throw new Error('expected a button');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRM_ARMS_AFTER_MS - 1);
    });
    expect(confirm.disabled).toBe(false);
  });

  it('puts Cancel where Take the cloud was, and Cancel puts everything back', () => {
    const settle = vi.spyOn(sync, 'settleFirstSync');
    render(<FirstSyncScreen local={1} remote={7} onSettled={vi.fn()} onSignedOut={vi.fn()} />);

    const before = screen.getAllByRole('button').map((button) => button.textContent);
    clickButton(/take the cloud/i);

    // Same row, same two slots: the second slot is where the finger is, and it
    // now holds the harmless button; the dangerous one took the first slot.
    const during = screen.getAllByRole('button').map((button) => button.textContent);
    expect(before).toEqual(['Upload mine', 'Take the cloud']);
    expect(during).toEqual(['Yes, replace mine', 'Cancel']);

    clickButton(/cancel/i);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(before);
    expect(settle).not.toHaveBeenCalled();
  });

  it('asks to sign in again when the session expired', async () => {
    vi.spyOn(sync, 'settleFirstSync').mockResolvedValue({ kind: 'unauthorized' });
    const onSettled = vi.fn();
    const onSignedOut = vi.fn();
    render(
      <FirstSyncScreen local={34} remote={120} onSettled={onSettled} onSignedOut={onSignedOut} />,
    );

    clickButton(/upload mine/i);
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));

    expect(onSettled).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('stays put and says why when the server shuts the door on too many attempts', async () => {
    vi.spyOn(sync, 'settleFirstSync').mockResolvedValue({ kind: 'refused', status: 429 });
    const onSettled = vi.fn();
    render(
      <FirstSyncScreen local={34} remote={120} onSettled={onSettled} onSignedOut={vi.fn()} />,
    );

    clickButton(/upload mine/i);
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeTruthy());

    expect(onSettled).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/too many attempts/i);
  });
});
