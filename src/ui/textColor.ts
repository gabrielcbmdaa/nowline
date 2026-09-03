/** Must stay in sync with the --no-project custom property in src/styles.css. */
export const NO_PROJECT_COLOR = '#8B8D98';

/** Must stay in sync with the --bg custom property in src/styles.css. */
export const PAGE_BACKGROUND = '#0F0F0F';

function channelToHex(value: number): string {
  return Math.round(value).toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Blends a 6-digit hex toward PAGE_BACKGROUND.
 * `alpha` is how much of the original colour survives, so 0.75 matches `opacity: 0.75`.
 */
export function dimTowardPage(background: string, alpha: number): string {
  const digits = background.slice(1);
  const pageDigits = PAGE_BACKGROUND.slice(1);
  const blend = (start: number): number => {
    const original = parseInt(digits.slice(start, start + 2), 16);
    const page = parseInt(pageDigits.slice(start, start + 2), 16);
    return original * alpha + page * (1 - alpha);
  };
  return `#${channelToHex(blend(0))}${channelToHex(blend(2))}${channelToHex(blend(4))}`;
}

function srgbChannelToLinear(channel: number): number {
  const srgb = channel / 255;
  if (srgb <= 0.03928) {
    return srgb / 12.92;
  }
  return ((srgb + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hex: string): number {
  const digits = hex.slice(1);
  const red = parseInt(digits.slice(0, 2), 16);
  const green = parseInt(digits.slice(2, 4), 16);
  const blue = parseInt(digits.slice(4, 6), 16);
  return (
    0.2126 * srgbChannelToLinear(red) +
    0.7152 * srgbChannelToLinear(green) +
    0.0722 * srgbChannelToLinear(blue)
  );
}

function contrastRatio(background: string, foreground: string): number {
  const lighter = Math.max(relativeLuminance(background), relativeLuminance(foreground));
  const darker = Math.min(relativeLuminance(background), relativeLuminance(foreground));
  return (lighter + 0.05) / (darker + 0.05);
}

/** Returns black or white, whichever contrasts more against a 6-digit hex background. */
export function readableTextColor(background: string): string {
  const black = '#000000';
  const white = '#FFFFFF';
  if (contrastRatio(background, black) > contrastRatio(background, white)) {
    return black;
  }
  return white;
}
