// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabBar } from './TabBar';

describe('TabBar', () => {
  afterEach(() => {
    cleanup();
  });

  it('offers the four tabs by name, and says which one is up', () => {
    const onChange = vi.fn();
    render(<TabBar active="calendar" onChange={onChange} />);

    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Calendar',
      'Summary',
      'Projects',
      'Account',
    ]);
    expect(screen.getByRole('button', { name: 'Calendar' }).getAttribute('aria-current')).toBe('page');

    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    expect(onChange).toHaveBeenCalledWith('account');

    const person = screen.getByRole('button', { name: 'Account' }).querySelector('path');
    expect(person?.getAttribute('d')).toBe('M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2');
    expect(screen.getByRole('button', { name: 'Account' }).querySelector('circle')?.getAttribute('r')).toBe('4');
  });
});
