import type { BlockOverride, BlockPlan, Project } from '../domain/types';
import type { SyncChanges } from './apiClient';
import {
  LocalStorageRepository,
  type PendingIds,
  type SentRows,
  type SyncState,
} from './localStorageRepository';

/**
 * The seam a future server slots into. Everything above this interface is
 * unaware of where the data lives; only one file below it is.
 * The methods are async even though localStorage is not, so that swapping in
 * a network implementation changes no call site.
 */
export interface BlockRepository {
  listProjects(): Promise<Project[]>;
  saveProject(project: Project): Promise<void>;
  /** Blocks of a deleted project keep working, unassigned. */
  deleteProject(id: string): Promise<void>;

  listPlans(): Promise<BlockPlan[]>;
  savePlan(plan: BlockPlan): Promise<void>;
  /** Deleting a plan also removes the per-day overrides that belonged to it. */
  deletePlan(id: string): Promise<void>;

  /** Omit the range to read every override. */
  listOverrides(fromDate?: string, toDate?: string): Promise<BlockOverride[]>;
  saveOverride(override: BlockOverride): Promise<void>;
  deleteOverride(id: string): Promise<void>;

  listPending(): Promise<PendingIds>;
  rowsToUpload(pending: PendingIds): Promise<SyncChanges>;
  clearPendingUnchanged(sent: SentRows): Promise<void>;
  readSyncState(): Promise<SyncState>;
  writeSyncState(next: SyncState): Promise<void>;
}

export const repository: BlockRepository = new LocalStorageRepository();
