/** A project is nothing but a coloured label in this version. */
export type Project = {
  id: string;
  name: string;
  /** Hex value taken from PROJECT_COLORS. */
  color: string;
  /** ISO 8601 with seconds. */
  createdAt: string;
};

export const PROJECT_COLORS = [
  '#E5484D',
  '#F76B15',
  '#FFB224',
  '#46A758',
  '#0091FF',
  '#8E4EC6',
  '#E93D82',
  '#8B8D98',
] as const;

export type Recurrence =
  | { type: 'none' }
  | { type: 'daily' }
  /** 0 = Sunday … 6 = Saturday. */
  | { type: 'weekly'; weekdays: number[] };

/**
 * The intention. A repeating block is one row no matter how many days it
 * shows up on; the day it actually happened lives in a BlockOverride.
 */
export type BlockPlan = {
  id: string;
  title: string;
  projectId: string | null;
  /** Minutes from local midnight, 0..1439. */
  startMinute: number;
  durationMinutes: number;
  recurrence: Recurrence;
  /** 'YYYY-MM-DD', the first day this plan applies to. */
  anchorDate: string;
  /** 'YYYY-MM-DD' or null for open-ended. */
  endDate: string | null;
  createdAt: string;
};

export type OverrideStatus = 'scheduled' | 'running' | 'done' | 'deleted';

/**
 * What actually happened on one specific day. Writing one of these never
 * touches the plan, which is why tomorrow still shows the original time.
 */
export type BlockOverride = {
  id: string;
  planId: string;
  /** 'YYYY-MM-DD', the occurrence day in local time. */
  date: string;
  status: OverrideStatus;
  /** ISO 8601 with seconds, written on play. */
  actualStart: string | null;
  /** ISO 8601 with seconds, written on stop. */
  actualEnd: string | null;
  /** Manual reschedule for this day only; shadows the plan. */
  startMinute: number | null;
  /** Manual resize for this day only; shadows the plan. */
  durationMinutes: number | null;
};

/** A plan and its override for one day, resolved into something drawable. */
export type ResolvedOccurrence = {
  planId: string;
  date: string;
  title: string;
  project: Project | null;
  status: 'scheduled' | 'running' | 'done';
  displayStart: Date;
  displayEnd: Date;
};
