// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PIXELS_PER_HOUR } from '../../domain/geometry';
import type { ResolvedOccurrence } from '../../domain/types';
import * as store from '../../state/store';
import { TimeBlockView } from './TimeBlockView';

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

const scheduled: ResolvedOccurrence = {
  planId: 'p1',
  date: '2026-09-17',
  title: 'Deep work',
  project: null,
  status: 'scheduled',
  displayStart: new Date(2026, 8, 17, 10, 0),
  displayEnd: new Date(2026, 8, 17, 11, 0),
};

function pointer(
  block: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointercancel',
  clientY: number,
): void {
  fireEvent(
    block,
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      clientY,
      buttons: type === 'pointercancel' ? 0 : 1,
    }),
  );
}

describe('a pinch aborts a drag in progress, and writes nothing', () => {
  beforeEach(() => {
    vi.spyOn(store, 'saveOverride').mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('puts the block back where it was and never saves', () => {
    const { saveOverride } = store;
    const { container } = render(
      <TimeBlockView
        occurrence={scheduled}
        isToday={false}
        pixelsPerHour={DEFAULT_PIXELS_PER_HOUR}
        onTap={() => {}}
        onToggleTimer={() => {}}
      />,
    );
    const block = container.querySelector<HTMLElement>('.block');
    if (!block) throw new Error('no block rendered');
    // 10:00 is minute 600, and one pixel is one minute at this scale.
    expect(block.style.top).toBe('600px');

    act(() => {
      pointer(block, 'pointerdown', 100);
      pointer(block, 'pointermove', 160);
    });
    // An hour down: 11:00, minute 660.
    expect(block.style.top).toBe('660px');

    act(() => {
      pointer(block, 'pointercancel', 160);
    });
    expect(block.style.top).toBe('600px');
    expect(saveOverride).not.toHaveBeenCalled();
  });

  it('gives the drag up when a second pointer joins, without an event of its own', () => {
    const { saveOverride, abortGestures } = store;
    const { container } = render(
      <TimeBlockView
        occurrence={scheduled}
        isToday={false}
        pixelsPerHour={DEFAULT_PIXELS_PER_HOUR}
        onTap={() => {}}
        onToggleTimer={() => {}}
      />,
    );
    const block = container.querySelector<HTMLElement>('.block');
    if (!block) throw new Error('no block rendered');

    act(() => {
      pointer(block, 'pointerdown', 100);
      pointer(block, 'pointermove', 160);
    });
    expect(block.style.top).toBe('660px');

    // What the container does the moment the second finger lands. No pointer
    // event reaches the block: events bubble, and this one happened above it.
    act(() => {
      abortGestures();
    });

    expect(block.style.top).toBe('600px');
    expect(saveOverride).not.toHaveBeenCalled();
  });
});
