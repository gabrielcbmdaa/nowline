// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PIXELS_PER_HOUR } from '../../domain/geometry';
import { getState, loadAll, setZoom } from '../../state/store';
import { CalendarScreen } from './CalendarScreen';

const noop = () => {};

/**
 * Only the scale in the store is asserted. jsdom does no layout: clientHeight
 * and scrollHeight are 0 and nothing moves scrollTop, so a test that checked
 * the new scrollTop here would be comparing zeros and could not fail. The
 * scrollTop arithmetic is pinned in domain/zoom.test.ts, which is pure.
 */
describe('the calendar zooms from the keyboard', () => {
  beforeEach(async () => {
    localStorage.clear();
    await loadAll();
    // loadAll does not reset pixelsPerHour; earlier tests in this file change it.
    setZoom(DEFAULT_PIXELS_PER_HOUR);
  });

  afterEach(cleanup);

  function scroller(): HTMLElement {
    const { container } = render(
      <CalendarScreen onCreateBlock={noop} onEditBlock={noop} />,
    );
    const element = container.querySelector<HTMLElement>('.calendar__scroll');
    if (!element) throw new Error('no scroll container rendered');
    return element;
  }

  it('grows the hour by one step on +, and shrinks it on -', () => {
    const element = scroller();
    fireEvent.keyDown(element, { key: '+' });
    expect(getState().pixelsPerHour).toBe(70);
    fireEvent.keyDown(element, { key: '-' });
    fireEvent.keyDown(element, { key: '-' });
    expect(getState().pixelsPerHour).toBe(50);
  });

  it('takes = as +, the same physical key without the shift', () => {
    fireEvent.keyDown(scroller(), { key: '=' });
    expect(getState().pixelsPerHour).toBe(70);
  });

  it('returns to the default on 0, from either side', () => {
    const element = scroller();
    fireEvent.keyDown(element, { key: '+' });
    fireEvent.keyDown(element, { key: '+' });
    expect(getState().pixelsPerHour).toBe(80);
    fireEvent.keyDown(element, { key: '0' });
    expect(getState().pixelsPerHour).toBe(DEFAULT_PIXELS_PER_HOUR);
  });

  it('stops at the limits instead of running past them', () => {
    const element = scroller();
    for (let press = 0; press < 12; press += 1) fireEvent.keyDown(element, { key: '+' });
    expect(getState().pixelsPerHour).toBe(140);
    for (let press = 0; press < 20; press += 1) fireEvent.keyDown(element, { key: '-' });
    expect(getState().pixelsPerHour).toBe(30);
  });

  it('leaves the scale alone when a modifier is held, so browser zoom still works', () => {
    const element = scroller();
    // One-way steps, asserted after each: Ctrl++ then Cmd+- cancel, so a single
    // expect after both stays green with or without the guard.
    fireEvent.keyDown(element, { key: '+', ctrlKey: true });
    expect(getState().pixelsPerHour).toBe(DEFAULT_PIXELS_PER_HOUR);
    fireEvent.keyDown(element, { key: '-', metaKey: true });
    expect(getState().pixelsPerHour).toBe(DEFAULT_PIXELS_PER_HOUR);
    fireEvent.keyDown(element, { key: '=', altKey: true });
    expect(getState().pixelsPerHour).toBe(DEFAULT_PIXELS_PER_HOUR);
  });

  it('paints an hour line at the scale the state holds', () => {
    const element = scroller();
    fireEvent.keyDown(element, { key: '+' });
    // 1 AM is the first hour line; at 70px/hour it sits at pixel 70.
    const line = element.querySelector<HTMLElement>('.hour-line');
    if (!line) throw new Error('no hour line rendered');
    expect(line.style.top).toBe('70px');
  });
});
