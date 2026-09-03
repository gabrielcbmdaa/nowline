import { describe, expect, it } from 'vitest';
import { PROJECT_COLORS } from '../domain/types';
import { dimTowardPage, NO_PROJECT_COLOR, PAGE_BACKGROUND, readableTextColor } from './textColor';

/**
 * Independent WCAG contrast helper for the assertions below.
 * Uses the IEC 61966-2-1 sRGB linearization threshold (0.04045), not the
 * production picker's WCAG 2.x constant, so a copy-paste of the
 * implementation cannot accidentally make these tests pass.
 */
function linearize(channel: number): number {
  const srgb = channel / 255;
  if (srgb <= 0.04045) {
    return srgb / 12.92;
  }
  return ((srgb + 0.055) / 1.055) ** 2.4;
}

function luminanceOf(hex: string): number {
  const digits = hex.slice(1);
  const red = parseInt(digits.slice(0, 2), 16);
  const green = parseInt(digits.slice(2, 4), 16);
  const blue = parseInt(digits.slice(4, 6), 16);
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

function contrastRatio(first: string, second: string): number {
  const brighter = Math.max(luminanceOf(first), luminanceOf(second));
  const dimmer = Math.min(luminanceOf(first), luminanceOf(second));
  return (brighter + 0.05) / (dimmer + 0.05);
}

describe('readableTextColor', () => {
  it('keeps PROJECT_COLORS above the WCAG AA contrast floor of 4.5', () => {
    for (const colour of PROJECT_COLORS) {
      expect(contrastRatio(colour, readableTextColor(colour))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks black on yellow and white on purple', () => {
    expect(readableTextColor('#FFB224')).toBe('#000000');
    expect(readableTextColor('#8E4EC6')).toBe('#FFFFFF');
  });

  it('keeps the no-project grey above the WCAG AA contrast floor of 4.5', () => {
    expect(
      contrastRatio(NO_PROJECT_COLOR, readableTextColor(NO_PROJECT_COLOR)),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe('dimTowardPage', () => {
  it('keeps dimmed PROJECT_COLORS above the WCAG AA contrast floor of 4.5', () => {
    for (const colour of PROJECT_COLORS) {
      const dimmed = dimTowardPage(colour, 0.75);
      expect(contrastRatio(dimmed, readableTextColor(dimmed))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the dimmed no-project grey above the WCAG AA contrast floor of 4.5', () => {
    const dimmed = dimTowardPage(NO_PROJECT_COLOR, 0.75);
    expect(contrastRatio(dimmed, readableTextColor(dimmed))).toBeGreaterThanOrEqual(4.5);
  });

  it('pins alpha 1 to the original colour and alpha 0 to PAGE_BACKGROUND', () => {
    const colour = '#E5484D';
    expect(dimTowardPage(colour, 1)).toBe(colour);
    expect(dimTowardPage(colour, 0)).toBe(PAGE_BACKGROUND);
  });

  /**
   * The endpoints alone cannot tell a linear blend from a curved one. These are the
   * exact values Chrome composites for `opacity: 0.75` over #0F0F0F.
   */
  it('pins the 75% blend to the values the browser produces', () => {
    expect(dimTowardPage('#E5484D', 0.75)).toBe('#B03A3E');
    expect(dimTowardPage('#FFB224', 0.75)).toBe('#C3891F');
    expect(dimTowardPage('#8E4EC6', 0.75)).toBe('#6E3E98');
  });
});
