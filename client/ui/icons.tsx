import type { ReactNode } from 'react';

export type IconProps = {
  className?: string;
};

/**
 * Lucide icons, stripped to their paths. Drawn with currentColor so they take the
 * colour of the element around them, and sized by CSS rather than by attributes.
 */
function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * The filled counterpart. The shape itself is the ink, so there is no stroke: a
 * stroke would only paint half its width outside the outline and fatten the icon.
 */
function SolidIcon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M8 2v3" />
      <path d="M16 2v3" />
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
    </Icon>
  );
}

export function SummaryIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 16v5" />
      <path d="M16 14.639V21" />
      <path d="M20 10.656V21" />
      <path d="m22 3-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15" />
      <path d="M4 18.463V21" />
      <path d="M8 14.656V21" />
    </Icon>
  );
}

export function ProjectsIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M2 10h20" />
    </Icon>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <SolidIcon className={className}>
      <path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z" />
    </SolidIcon>
  );
}

/**
 * Lucide draws this square at 18 of 24. Filled, a compact block reads heavier than
 * a triangle of the same width, so it is pulled in to 16 to match the play visually.
 */
export function StopIcon({ className }: IconProps) {
  return (
    <SolidIcon className={className}>
      <rect width="16" height="16" x="4" y="4" rx="2" />
    </SolidIcon>
  );
}
