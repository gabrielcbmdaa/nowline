// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordField } from './PasswordField';

function input(): HTMLInputElement {
  // By its label alone: the Show button sits outside the label on purpose, or
  // the label would read "PasswordShow" and no one could find the field by name.
  const element = screen.getByLabelText('Password');
  if (!(element instanceof HTMLInputElement)) throw new Error('expected an input');
  return element;
}

describe('PasswordField', () => {
  afterEach(() => {
    cleanup();
  });

  it('hides the password until asked, and hides it again', () => {
    render(<PasswordField id="p" label="Password" value="secret" autoComplete="new-password" onChange={vi.fn()} />);

    expect(input().type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input().type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(input().type).toBe('password');
  });

  it('hands up what is typed', () => {
    const onChange = vi.fn();
    render(<PasswordField id="p" label="Password" value="" autoComplete="new-password" onChange={onChange} />);

    fireEvent.change(input(), { target: { value: 'typed' } });

    expect(onChange).toHaveBeenCalledWith('typed');
  });

  it('is named by its label alone; the toggle is not part of the name', () => {
    render(<PasswordField id="p" label="Password" value="" autoComplete="new-password" onChange={vi.fn()} />);

    // Testing Library skips nested controls when it reads a label, so the
    // query above cannot tell. A screen reader does not skip them: with the
    // toggle inside the label the field would be announced as "Password Show".
    expect(input().labels?.[0]?.textContent).toBe('Password');
  });

  it('does not submit the form it sits in when the toggle is pressed', () => {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => {
      event.preventDefault();
    });
    render(
      <form onSubmit={onSubmit}>
        <PasswordField id="p" label="Password" value="" autoComplete="new-password" onChange={vi.fn()} />
      </form>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
