// @vitest-environment jsdom
//
// What is covered here is everything in `Sheet` that does not ask the DOM where
// anything is: Escape, the stack of open sheets, and the focus put back on unmount.
//
// What is deliberately left out is the other half — the focus placed on open and the
// Tab cycle — because both go through `getFocusable`, which filters on
// `getClientRects().length > 0`, and jsdom does no layout. Measured on 2026-09-06: a
// rendered sheet with a visible button inside reports zero boxes for every element, so
// the list comes back empty and focus lands on the panel through the fallback branch
// instead of on the close button. A test written here would pin the fallback, not the
// behaviour. `initialFocus` does not go through `getFocusable`, so the focus a sheet asks for is covered below.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

/** A sheet that asks for its name field, the way the project editor does when creating. */
function AskingForTheName() {
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <Sheet title="Asking" onClose={() => {}} initialFocus={nameRef}>
      <button>Before</button>
      <input ref={nameRef} aria-label="Name" />
    </Sheet>
  );
}

function pressEscape(init: KeyboardEventInit = {}): void {
  fireEvent.keyDown(document, { key: 'Escape', ...init });
}

describe('Sheet', () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Sheet title="Only" onClose={onClose}>
        <button>Inside</button>
      </Sheet>,
    );

    pressEscape();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ignores Escape while an IME composition is open', () => {
    const onClose = vi.fn();
    render(
      <Sheet title="Only" onClose={onClose}>
        <button>Inside</button>
      </Sheet>,
    );

    pressEscape({ isComposing: true });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes only the topmost sheet when two are open', () => {
    const closeBelow = vi.fn();
    const closeAbove = vi.fn();
    render(
      <>
        <Sheet key="below" title="Below" onClose={closeBelow}>
          <button>Below</button>
        </Sheet>
        <Sheet key="above" title="Above" onClose={closeAbove}>
          <button>Above</button>
        </Sheet>
      </>,
    );

    pressEscape();

    expect(closeAbove).toHaveBeenCalledOnce();
    expect(closeBelow).not.toHaveBeenCalled();
  });

  it('hands Escape back to the sheet below once the top one unmounts', () => {
    const closeBelow = vi.fn();
    const { rerender } = render(
      <>
        <Sheet key="below" title="Below" onClose={closeBelow}>
          <button>Below</button>
        </Sheet>
        <Sheet key="above" title="Above" onClose={() => {}}>
          <button>Above</button>
        </Sheet>
      </>,
    );

    rerender(
      <>
        <Sheet key="below" title="Below" onClose={closeBelow}>
          <button>Below</button>
        </Sheet>
      </>,
    );
    pressEscape();

    expect(closeBelow).toHaveBeenCalledOnce();
  });

  it('returns focus to whatever held it before the sheet opened', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(
      <Sheet title="Only" onClose={() => {}}>
        <button>Inside</button>
      </Sheet>,
    );
    unmount();

    expect(document.activeElement).toBe(opener);
  });

  it('puts the initial focus where it is asked to', () => {
    render(<AskingForTheName />);
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it('returns focus to the opener even when it asked for an initial focus', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(<AskingForTheName />);
    // The focus moved — and the sheet still remembers where it came from.
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
    unmount();

    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
