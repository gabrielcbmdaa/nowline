// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PIXELS_PER_HOUR } from '../../domain/geometry';
import { DaySection } from './DaySection';

afterEach(cleanup);

const noop = () => {};

describe('DaySection gutter heading', () => {
  it('splits a date into weekday and month-day so the label stays in the hour gutter', () => {
    render(
      <DaySection
        date="2026-09-16"
        pixelsPerHour={DEFAULT_PIXELS_PER_HOUR}
        occurrences={[]}
        now={new Date(2026, 8, 15, 12, 0)}
        onBackgroundTap={noop}
        onOccurrenceTap={noop}
        onToggleTimer={noop}
      />,
    );

    expect(screen.getByText('Wed')).toBeTruthy();
    expect(screen.getByText('Sep 16')).toBeTruthy();
    expect(screen.queryByText('Wed, Sep 16')).toBeNull();
  });

  it('keeps Today on a single line', () => {
    render(
      <DaySection
        date="2026-09-15"
        pixelsPerHour={DEFAULT_PIXELS_PER_HOUR}
        occurrences={[]}
        now={new Date(2026, 8, 15, 12, 0)}
        onBackgroundTap={noop}
        onOccurrenceTap={noop}
        onToggleTimer={noop}
      />,
    );

    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.queryByText('Sep 15')).toBeNull();
  });
});
