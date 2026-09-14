// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Fab } from './Fab';
import { Sheet } from './Sheet';

afterEach(cleanup);

/** The FAB as App uses it: an item opens a sheet, and the sheet closes itself. */
function FabThatOpensASheet() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Fab actions={[{ label: 'New thing', onSelect: () => setOpen(true) }]} />
      {open && (
        <Sheet title="New thing" onClose={() => setOpen(false)}>
          <input aria-label="Name" />
        </Sheet>
      )}
    </>
  );
}

/** A real tap focuses the button before the click lands; jsdom does not, so do it by hand. */
function press(name: string): void {
  const button = screen.getByRole('button', { name });
  button.focus();
  fireEvent.click(button);
}

describe('Fab', () => {
  it('hands focus back to its own button when an item is chosen', () => {
    render(<Fab actions={[{ label: 'New thing', onSelect: vi.fn() }]} />);
    press('Add');
    press('New thing');

    // The item is gone with the menu; the button is what is left to hold focus.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add' }));
  });

  it('so a sheet opened from the menu returns focus to the button on close', () => {
    render(<FabThatOpensASheet />);
    press('Add');
    press('New thing');
    press('Close');

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add' }));
  });
});
