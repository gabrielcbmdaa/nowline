// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONFIRM_ARMS_AFTER_MS } from './FirstSyncScreen';
import { OtherAccountPrompt } from './OtherAccountPrompt';

function button(name: string | RegExp): HTMLButtonElement {
  const found = screen.getByRole('button', { name });
  if (!(found instanceof HTMLButtonElement)) throw new Error('expected a button');
  return found;
}

describe('OtherAccountPrompt', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('says how many changes would leave the device, in the singular too', () => {
    render(
      <OtherAccountPrompt
        question={{ kind: 'other-account', atRisk: 1 }}
        busy={false}
        onAnswer={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // The number is the question. "Are you sure?" would tell nobody what goes.
    expect(
      screen.getByText((_, node) =>
        node?.tagName === 'P' && /1 change made here has not reached/i.test(node.textContent || ''),
      ),
    ).toBeTruthy();
    expect(screen.getByText(/copy stays/i)).toBeTruthy();
  });

  it('does not let the second tap of a double tap remove anything', async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();
    render(
      <OtherAccountPrompt
        question={{ kind: 'other-account', atRisk: 3 }}
        busy={false}
        onAnswer={onAnswer}
        onCancel={vi.fn()}
      />,
    );

    fireEvent.click(button(/remove and continue/i));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRM_ARMS_AFTER_MS - 1);
    });
    expect(button(/remove and continue/i).disabled).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(button(/remove and continue/i).disabled).toBe(false);
    expect(onAnswer).not.toHaveBeenCalled();

    fireEvent.click(button(/remove and continue/i));
    expect(onAnswer).toHaveBeenCalledWith('discard');
  });

  it('lets Cancel through at once', () => {
    const onCancel = vi.fn();
    render(
      <OtherAccountPrompt
        question={{ kind: 'other-account', atRisk: 3 }}
        busy={false}
        onAnswer={vi.fn()}
        onCancel={onCancel}
      />,
    );

    fireEvent.click(button(/cancel/i));

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('offers to keep rows no account claims, armed like the removal', async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();
    render(
      <OtherAccountPrompt
        question={{ kind: 'unknown-owner', rows: 12 }}
        busy={false}
        onAnswer={onAnswer}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/12 blocks not linked to any account/i)).toBeTruthy();
    // Keeping is not harmless: into an empty cloud, those rows upload with no
    // further question.
    expect(button(/they are mine/i).disabled).toBe(true);
    expect(button(/remove them/i).disabled).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(CONFIRM_ARMS_AFTER_MS);
    });
    expect(button(/they are mine/i).disabled).toBe(false);
    expect(button(/remove them/i).disabled).toBe(false);
    fireEvent.click(button(/they are mine/i));

    expect(onAnswer).toHaveBeenCalledWith('keep');
  });

  it('holds every button while an answer is being carried out', async () => {
    vi.useFakeTimers();
    const questions = [
      { kind: 'other-account', atRisk: 3 },
      { kind: 'unknown-owner', rows: 2 },
    ] as const;

    for (const question of questions) {
      render(<OtherAccountPrompt question={question} busy onAnswer={vi.fn()} onCancel={vi.fn()} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CONFIRM_ARMS_AFTER_MS);
      });

      // Both screens, Cancel included: while an answer runs, a second answer or
      // a cancel would race the engine's door with a stale question.
      for (const each of screen.getAllByRole('button')) {
        if (!(each instanceof HTMLButtonElement)) throw new Error('expected a button');
        expect(each.disabled).toBe(true);
      }
      cleanup();
    }
  });
});
