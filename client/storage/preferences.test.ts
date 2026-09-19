// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { reportWarning } from '../reportError';
import {
  DEFAULT_PIXELS_PER_HOUR,
  MAX_PIXELS_PER_HOUR,
  MIN_PIXELS_PER_HOUR,
} from '../domain/geometry';
import { readZoom, writeZoom } from './preferences';

vi.mock('../reportError', () => ({ reportError: vi.fn(), reportWarning: vi.fn() }));

const warned = reportWarning as Mock;

describe('the zoom this device prefers', () => {
  beforeEach(() => {
    localStorage.clear();
    warned.mockClear();
  });

  afterEach(() => localStorage.clear());

  it('answers the default when nothing was ever stored, quietly', () => {
    expect(readZoom()).toBe(DEFAULT_PIXELS_PER_HOUR);
    expect(warned).not.toHaveBeenCalled();
  });

  it('reads back what was written', () => {
    writeZoom(97);
    expect(readZoom()).toBe(97);
    expect(localStorage.getItem('nowline.zoom.v1')).toBe('97');
  });

  it('clamps what it is asked to write, so no key can hold an impossible scale', () => {
    writeZoom(5000);
    expect(readZoom()).toBe(MAX_PIXELS_PER_HOUR);
    writeZoom(1);
    expect(readZoom()).toBe(MIN_PIXELS_PER_HOUR);
  });

  it('treats an unreadable value as absent, and says so', () => {
    localStorage.setItem('nowline.zoom.v1', 'not a number');
    expect(readZoom()).toBe(DEFAULT_PIXELS_PER_HOUR);
    expect(String(warned.mock.calls[0][0])).toContain('nowline.zoom.v1');
  });

  it('treats a value outside the range as absent, and says so', () => {
    localStorage.setItem('nowline.zoom.v1', '4000');
    expect(readZoom()).toBe(DEFAULT_PIXELS_PER_HOUR);
    expect(String(warned.mock.calls[0][0])).toContain('nowline.zoom.v1');
  });

  it('never removes the key, only overwrites it', () => {
    writeZoom(80);
    localStorage.setItem('nowline.zoom.v1', 'broken');
    readZoom();
    expect(localStorage.getItem('nowline.zoom.v1')).toBe('broken');
  });
});
