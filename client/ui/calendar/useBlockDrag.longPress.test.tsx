// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PIXELS_PER_HOUR } from '../../domain/geometry';
import type { ResolvedOccurrence } from '../../domain/types';
import { dimTowardPage, NO_PROJECT_COLOR } from '../textColor';
import * as store from '../../state/store';
import { LONG_PRESS_MS } from './useBlockDrag';
import { ARMED_DIM, TimeBlockView } from './TimeBlockView';

// jsdom lacks PointerEvent in some vitest builds; MouseEvent carries clientY.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? '';
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
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  clientY: number,
  pointerType: string,
): void {
  fireEvent(
    block,
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      pointerType,
      isPrimary: true,
      clientY,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
    }),
  );
}

function cssHex(element: HTMLElement): string {
  const value = element.style.background;
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value);
  if (!rgb) return value;
  const hex = (channel: string): string =>
    Number(channel).toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
}

function renderBlock(onTap: () => void = () => {}): HTMLElement {
  const { container } = render(
    <TimeBlockView
      occurrence={scheduled}
      isToday={false}
      pixelsPerHour={DEFAULT_PIXELS_PER_HOUR}
      onTap={onTap}
      onToggleTimer={() => {}}
    />,
  );
  const block = container.querySelector<HTMLElement>('.block');
  if (!block) throw new Error('no block rendered');
  return block;
}

describe('a touch does not drag a scheduled block until it has been held', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(store, 'saveOverride').mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('leaves the block put if the finger moves before the second is up', async () => {
    const block = renderBlock();
    expect(block.style.top).toBe('600px');

    await act(async () => {
      pointer(block, 'pointerdown', 100, 'touch');
      pointer(block, 'pointermove', 160, 'touch');
    });
    expect(block.style.top).toBe('600px');
  });

  it('starts the drag only after the hold, then a move of an hour lands at 11:00', async () => {
    const block = renderBlock();

    await act(async () => {
      pointer(block, 'pointerdown', 100, 'touch');
    });
    expect(block.style.top).toBe('600px');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
      pointer(block, 'pointermove', 160, 'touch');
    });
    expect(block.style.top).toBe('660px');
  });

  it('opens the editor on a lift before the hold, without a save', async () => {
    const onTap = vi.fn();
    const block = renderBlock(onTap);

    await act(async () => {
      pointer(block, 'pointerdown', 100, 'touch');
      pointer(block, 'pointerup', 100, 'touch');
    });
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(store.saveOverride).not.toHaveBeenCalled();
    expect(block.style.top).toBe('600px');
  });

  it('does not open the editor if the finger moved past slop before the hold', async () => {
    const onTap = vi.fn();
    const block = renderBlock(onTap);

    await act(async () => {
      pointer(block, 'pointerdown', 100, 'touch');
      pointer(block, 'pointermove', 110, 'touch');
      pointer(block, 'pointerup', 110, 'touch');
    });
    expect(onTap).not.toHaveBeenCalled();
    expect(store.saveOverride).not.toHaveBeenCalled();
    expect(block.style.top).toBe('600px');
  });

  it('gives the hold up when a second pointer joins, so the timer never arms', async () => {
    const block = renderBlock();

    await act(async () => {
      pointer(block, 'pointerdown', 100, 'touch');
      store.abortGestures();
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
      pointer(block, 'pointermove', 160, 'touch');
    });
    expect(block.style.top).toBe('600px');
    expect(store.saveOverride).not.toHaveBeenCalled();
  });

  it('still drags immediately with a mouse, without waiting', async () => {
    const block = renderBlock();

    await act(async () => {
      pointer(block, 'pointerdown', 100, 'mouse');
      pointer(block, 'pointermove', 160, 'mouse');
    });
    expect(block.style.top).toBe('660px');
  });

  it('still opens the editor on a mouse click without a drag', async () => {
    const onTap = vi.fn();
    const block = renderBlock(onTap);

    await act(async () => {
      pointer(block, 'pointerdown', 100, 'mouse');
      pointer(block, 'pointerup', 100, 'mouse');
    });
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('darkens once the hold has armed, and restores on lift', async () => {
    const block = renderBlock();
    expect(cssHex(block)).toBe(NO_PROJECT_COLOR);

    await act(async () => {
      pointer(block, 'pointerdown', 100, 'touch');
    });
    expect(cssHex(block)).toBe(NO_PROJECT_COLOR);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
    });
    expect(cssHex(block)).toBe(dimTowardPage(NO_PROJECT_COLOR, ARMED_DIM));

    await act(async () => {
      pointer(block, 'pointerup', 100, 'touch');
    });
    expect(cssHex(block)).toBe(NO_PROJECT_COLOR);
  });

  it('does not open the editor if the hold armed and the finger never moved', async () => {
    const onTap = vi.fn();
    const block = renderBlock(onTap);

    await act(async () => {
      pointer(block, 'pointerdown', 100, 'touch');
      await vi.advanceTimersByTimeAsync(LONG_PRESS_MS);
      pointer(block, 'pointerup', 100, 'touch');
    });
    expect(onTap).not.toHaveBeenCalled();
    expect(store.saveOverride).not.toHaveBeenCalled();
  });
});
