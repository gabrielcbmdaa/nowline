// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { atMinute } from '../../domain/dates';
import { DEFAULT_PIXELS_PER_HOUR } from '../../domain/geometry';
import type { BlockPlan } from '../../domain/types';
import * as store from '../../state/store';
import { getState, loadAll, setZoom } from '../../state/store';
import { CalendarScreen } from './CalendarScreen';

// jsdom lacks PointerEvent in some vitest builds; MouseEvent carries clientY.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as typeof PointerEvent;
}

// jsdom gap: Pointer Capture API is missing; not a production test crutch.
Element.prototype.setPointerCapture = () => {};
Element.prototype.releasePointerCapture = () => {};

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

describe('a second finger on empty space aborts a drag that started on a block', () => {
  beforeEach(async () => {
    localStorage.clear();
    const date = '2026-09-18';
    const start = atMinute(date, 10 * 60);
    const plan: BlockPlan = {
      id: 'p1',
      title: 'Deep work',
      projectId: null,
      startMinute: 10 * 60,
      durationMinutes: 60,
      recurrence: { type: 'none' },
      anchorDate: date,
      endDate: null,
      createdAt: start.toISOString(),
      updatedAt: start.toISOString(),
      deletedAt: null,
    };
    localStorage.setItem('nowline.plans.v2', JSON.stringify([plan]));
    vi.setSystemTime(atMinute(date, 11 * 60));
    await loadAll();
    setZoom(DEFAULT_PIXELS_PER_HOUR);
    vi.spyOn(store, 'saveOverride').mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('puts the block back and does not save, even though the block stopped the bubble', () => {
    const { container } = render(
      <CalendarScreen onCreateBlock={noop} onEditBlock={noop} />,
    );
    const scroller = container.querySelector<HTMLElement>('.calendar__scroll');
    const block = container.querySelector<HTMLElement>('.block');
    if (!scroller || !block) throw new Error('no scroller or block');
    // 10:00 is minute 600, and one pixel is one minute at this scale.
    expect(block.style.top).toBe('600px');

    fireEvent(
      block,
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        clientY: 100,
        buttons: 1,
      }),
    );
    fireEvent(
      block,
      new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        clientY: 160,
        buttons: 1,
      }),
    );
    expect(block.style.top).toBe('660px');

    // Second finger on the empty scroller — the path the phone measured.
    fireEvent(
      scroller,
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 2,
        clientY: 200,
        buttons: 1,
      }),
    );
    // Assert here, before pointerup: end() also resetPreview()s, so a top of
    // 600 after lift would stay green even if abort never ran.
    expect(block.style.top).toBe('600px');

    fireEvent(
      block,
      new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerId: 1,
        clientY: 160,
        buttons: 0,
      }),
    );
    expect(store.saveOverride).not.toHaveBeenCalled();
  });
});
