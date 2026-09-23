export interface CodingAgentInvocation {
  /** Immutable Execution Run identity, already validated before this is constructed. */
  executionRequestId: string;
  /** The immutable task input the coding agent must perform. */
  task: {
    title: string;
    prompt: string;
  };
  /** The already-materialised live repository workspace; it still exists while this runs. */
  workspace: {
    path: string;
    /** The exact Git HEAD SHA already durably persisted as `sourceRevision` before this runs. */
    headSha: string;
  };
}

/**
 * The extension point the next ADA capability (a real coding-agent runtime) replaces. Invoked only
 * after a winning claim and a durably persisted `sourceRevision`, and only while the workspace is
 * guaranteed to still exist — see `runExecutor`.
 */
export type InvokeCodingAgent = (invocation: CodingAgentInvocation) => Promise<void>;

/** Intentionally a no-op in this slice; no coding-agent invocation is introduced yet. */
export const noopInvokeCodingAgent: InvokeCodingAgent = async () => {};
