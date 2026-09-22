export interface DownstreamWorkContext {
  /** The live workspace's local filesystem path; the workspace still exists while this runs. */
  workspacePath: string;
  /** The exact Git HEAD SHA already durably persisted as `sourceRevision` before this runs. */
  headSha: string;
}

/**
 * The extension point the next ADA capability (invoking a coding agent against the still-live
 * repository workspace) replaces. Invoked only after a winning claim and a durably persisted
 * `sourceRevision`, and only while the workspace is guaranteed to still exist — see `runExecutor`.
 */
export type RunDownstreamWork = (context: DownstreamWorkContext) => Promise<void>;

/** Intentionally a no-op in this slice; no coding-agent invocation is introduced yet. */
export const noopDownstreamWork: RunDownstreamWork = async () => {};
