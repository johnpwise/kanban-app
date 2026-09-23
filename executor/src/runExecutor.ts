import { randomUUID } from "node:crypto";

import { noopInvokeCodingAgent } from "./codingAgentInvocation";
import { parseExecutorConfig } from "./config";
import { ProcessCodingAgentRuntimeError } from "./processCodingAgentRuntime";
import { parseExecutionRunDocument } from "./schemas/executionRunDocument";

import type { InvokeCodingAgent } from "./codingAgentInvocation";
import type { EnsureAdaDeliveryBranch } from "./deliveryBranch";
import type { EnsureAdaDeliveryCommit } from "./deliveryCommit";
import type { ExecutionRunRepository } from "./executionRunRepository";
import type { VerifyGitIntegrity } from "./gitIntegrityVerification";
import type { MaterializeRepositoryWorkspace } from "./repositoryWorkspace";
import type { InspectWorkingTree } from "./workingTreeInspection";

export interface ExecutorLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export type ExecutorOutcome =
  | { ok: true; claimed: false }
  | { ok: true; claimed: true; workingTree: "clean" }
  | {
      ok: true;
      claimed: true;
      workingTree: "changes_detected";
      deliveryBranch: string;
      deliveryCommitSha: string;
    }
  | { ok: false; reason: string };

export interface RunExecutorParams {
  env: Record<string, string | undefined>;
  repository: ExecutionRunRepository;
  logger: ExecutorLogger;
  /** Materialises the immutable input's repository/baseBranch. Only ever called after a winning claim. */
  materializeRepositoryWorkspace: MaterializeRepositoryWorkspace;
  /**
   * Invoked against the still-live workspace, after `sourceRevision` is durably persisted and
   * before cleanup. Defaults to a no-op; overridable so a future ADA capability can plug in a real
   * coding-agent runtime without changing this composition.
   */
  invokeCodingAgent?: InvokeCodingAgent;
  /**
   * Verifies, against the still-live workspace, that a successful coding-agent invocation left
   * `HEAD` and the checked-out branch exactly as materialised — before working-tree inspection
   * runs. Required, like `materializeRepositoryWorkspace`: there is no safe default, since
   * silently reporting "verified" without checking would misrepresent the outcome. ADA retains
   * ownership of Git history and delivery; this is the boundary that enforces it.
   */
  verifyGitIntegrity: VerifyGitIntegrity;
  /**
   * Inspects the still-live workspace's Git working tree after git source-control integrity is
   * verified and before cleanup. Required, like `materializeRepositoryWorkspace`: there is no
   * safe default, since silently reporting "clean" without checking would misrepresent the
   * outcome.
   */
  inspectWorkingTree: InspectWorkingTree;
  /**
   * Derives, validates, creates, and verifies the ADA delivery branch in the still-live workspace,
   * invoked only when working-tree inspection reports `changes_detected`, before cleanup. Required,
   * like `verifyGitIntegrity` and `inspectWorkingTree`: there is no safe default, since silently
   * reporting a delivery branch without creating one would misrepresent the outcome.
   */
  ensureAdaDeliveryBranch: EnsureAdaDeliveryBranch;
  /**
   * Stages the coding-agent working-tree delta, creates the single ADA-owned local commit, and
   * verifies its resulting history/branch/parent, invoked only after the ADA delivery branch is
   * created and verified, before cleanup. Required, like `ensureAdaDeliveryBranch`: there is no
   * safe default, since silently reporting a delivery commit without creating one would
   * misrepresent the outcome.
   */
  ensureAdaDeliveryCommit: EnsureAdaDeliveryCommit;
  /** Generates the id persisted with a winning claim. Defaults to `randomUUID`; overridable for tests. */
  claimIdFactory?: () => string;
}

/**
 * Composes validate-environment -> load -> validate -> log -> outcome for the current minimal
 * shell behaviour. Every failure path returns `{ ok: false }` rather than throwing: a Cloud Run
 * Job container communicates failure to its caller purely through its process exit code (see
 * `main.ts`), so there is no redelivery concept here to preserve by rethrowing.
 */
export async function runExecutor({
  env,
  repository,
  logger,
  materializeRepositoryWorkspace,
  invokeCodingAgent = noopInvokeCodingAgent,
  verifyGitIntegrity,
  inspectWorkingTree,
  ensureAdaDeliveryBranch,
  ensureAdaDeliveryCommit,
  claimIdFactory = randomUUID,
}: RunExecutorParams): Promise<ExecutorOutcome> {
  let executionRunId: string;
  try {
    executionRunId = parseExecutorConfig(env).executionRunId;
  } catch {
    logger.error("Invalid or missing executor environment configuration.");
    return { ok: false, reason: "invalid_config" };
  }

  let data: unknown;
  try {
    data = await repository.loadExecutionRunData(executionRunId);
  } catch {
    logger.error("Transient failure loading the execution run.", { executionRunId });
    return { ok: false, reason: "repository_error" };
  }

  if (data === undefined) {
    logger.error("Execution run not found.", { executionRunId });
    return { ok: false, reason: "not_found" };
  }

  let run;
  try {
    run = parseExecutionRunDocument(executionRunId, data);
  } catch {
    logger.error("Execution run failed validation.", { executionRunId });
    return { ok: false, reason: "invalid_run" };
  }

  let claimOutcome;
  try {
    claimOutcome = await repository.claimExecutionRun(executionRunId, claimIdFactory());
  } catch {
    logger.error("Transient failure claiming the execution run.", { executionRunId });
    return { ok: false, reason: "claim_error" };
  }

  const safeIdentifiers = {
    executionRequestId: run.executionRequestId,
    correlationId: run.correlationId,
    projectId: run.projectId,
    cardId: run.cardId,
  };

  if (!claimOutcome.claimed) {
    logger.info("Execution run already claimed by another executor; exiting safely.", safeIdentifiers);
    return { ok: true, claimed: false };
  }

  let workspaceOutcome;
  try {
    workspaceOutcome = await materializeRepositoryWorkspace({
      repository: run.input.repository,
      baseBranch: run.input.baseBranch,
    });
  } catch {
    logger.error("Unexpected failure materialising the repository workspace.", safeIdentifiers);
    return { ok: false, reason: "workspace_error" };
  }

  if (!workspaceOutcome.ok) {
    logger.error("Failed to materialise the repository workspace.", {
      ...safeIdentifiers,
      reason: workspaceOutcome.reason,
      ...("gitErrorCode" in workspaceOutcome ? { gitErrorCode: workspaceOutcome.gitErrorCode } : {}),
    });
    return { ok: false, reason: workspaceOutcome.reason };
  }

  const { headSha } = workspaceOutcome.workspace;

  try {
    let recordOutcome;
    try {
      recordOutcome = await repository.recordSourceRevision(executionRunId, headSha);
    } catch {
      logger.error("Transient failure recording the resolved source revision.", { ...safeIdentifiers, headSha });
      return { ok: false, reason: "source_revision_error" };
    }

    if (recordOutcome.outcome === "conflict") {
      logger.error("A conflicting source revision is already persisted for this execution run.", {
        ...safeIdentifiers,
        headSha,
      });
      return { ok: false, reason: "source_revision_conflict" };
    }

    try {
      await invokeCodingAgent({
        executionRequestId: run.executionRequestId,
        task: { title: run.input.title, prompt: run.input.prompt },
        workspace: { path: workspaceOutcome.workspace.path, headSha },
      });
    } catch (error) {
      // ProcessCodingAgentRuntimeError's message is documented as built only from safe,
      // non-content values (exit codes, signal names, timeout duration) — safe to log. Any other
      // thrown error (e.g. a provider-config validation error) may embed unsafe detail, so only
      // this known-safe shape is included.
      const safeErrorFields =
        error instanceof ProcessCodingAgentRuntimeError ? { kind: error.kind, reason: error.message } : {};
      logger.error("Unexpected failure invoking the coding agent.", { ...safeIdentifiers, ...safeErrorFields });
      return { ok: false, reason: "coding_agent_invocation_error" };
    }

    let gitIntegrityOutcome;
    try {
      gitIntegrityOutcome = await verifyGitIntegrity({
        workspacePath: workspaceOutcome.workspace.path,
        expectedHeadSha: headSha,
        expectedBranch: run.input.baseBranch,
      });
    } catch {
      logger.error("Unexpected failure verifying Git source-control integrity.", safeIdentifiers);
      return { ok: false, reason: "git_integrity_inspection_failed" };
    }

    if (!gitIntegrityOutcome.ok) {
      if (gitIntegrityOutcome.reason === "head_changed") {
        logger.error("Coding-agent invocation left HEAD changed from the persisted source revision.", {
          ...safeIdentifiers,
          expectedHeadSha: gitIntegrityOutcome.expectedHeadSha,
          actualHeadSha: gitIntegrityOutcome.actualHeadSha,
        });
        return { ok: false, reason: "git_integrity_head_changed" };
      }
      if (gitIntegrityOutcome.reason === "branch_changed") {
        logger.error("Coding-agent invocation left the checked-out branch changed from the requested baseBranch.", {
          ...safeIdentifiers,
          expectedBranch: gitIntegrityOutcome.expectedBranch,
          actualBranch: gitIntegrityOutcome.actualBranch,
        });
        return { ok: false, reason: "git_integrity_branch_changed" };
      }
      logger.error("Failed to verify Git source-control integrity.", {
        ...safeIdentifiers,
        stage: gitIntegrityOutcome.stage,
        gitErrorCode: gitIntegrityOutcome.gitErrorCode,
      });
      return { ok: false, reason: "git_integrity_inspection_failed" };
    }

    let workingTreeOutcome;
    try {
      workingTreeOutcome = await inspectWorkingTree({ workspacePath: workspaceOutcome.workspace.path });
    } catch {
      logger.error("Unexpected failure inspecting the working tree.", safeIdentifiers);
      return { ok: false, reason: "working_tree_inspection_error" };
    }

    if (!workingTreeOutcome.ok) {
      logger.error("Failed to inspect the working tree.", {
        ...safeIdentifiers,
        gitErrorCode: workingTreeOutcome.gitErrorCode,
      });
      return { ok: false, reason: "working_tree_inspection_error" };
    }

    if (workingTreeOutcome.status === "clean") {
      logger.info("Accepted execution run loaded and validated successfully.", {
        ...safeIdentifiers,
        headSha,
        workingTree: "clean",
      });
      return { ok: true, claimed: true, workingTree: "clean" };
    }

    let deliveryBranchOutcome;
    try {
      deliveryBranchOutcome = await ensureAdaDeliveryBranch({
        workspacePath: workspaceOutcome.workspace.path,
        executionRequestId: run.executionRequestId,
      });
    } catch {
      logger.error("Unexpected failure creating the ADA delivery branch.", safeIdentifiers);
      return { ok: false, reason: "delivery_branch_error" };
    }

    if (!deliveryBranchOutcome.ok) {
      logger.error("Failed to create the ADA delivery branch.", {
        ...safeIdentifiers,
        reason: deliveryBranchOutcome.reason,
        ...("gitErrorCode" in deliveryBranchOutcome ? { gitErrorCode: deliveryBranchOutcome.gitErrorCode } : {}),
        ...("expectedBranch" in deliveryBranchOutcome
          ? { expectedBranch: deliveryBranchOutcome.expectedBranch, actualBranch: deliveryBranchOutcome.actualBranch }
          : {}),
      });
      return { ok: false, reason: `delivery_branch_${deliveryBranchOutcome.reason}` };
    }

    let deliveryCommitOutcome;
    try {
      deliveryCommitOutcome = await ensureAdaDeliveryCommit({
        workspacePath: workspaceOutcome.workspace.path,
        executionRequestId: run.executionRequestId,
        expectedBranch: deliveryBranchOutcome.branchName,
        expectedParentSha: headSha,
      });
    } catch {
      logger.error("Unexpected failure creating the ADA delivery commit.", safeIdentifiers);
      return { ok: false, reason: "delivery_commit_error" };
    }

    if (!deliveryCommitOutcome.ok) {
      logger.error("Failed to create the ADA delivery commit.", {
        ...safeIdentifiers,
        reason: deliveryCommitOutcome.reason,
        ...("gitErrorCode" in deliveryCommitOutcome ? { gitErrorCode: deliveryCommitOutcome.gitErrorCode } : {}),
        ...("expectedBranch" in deliveryCommitOutcome
          ? { expectedBranch: deliveryCommitOutcome.expectedBranch, actualBranch: deliveryCommitOutcome.actualBranch }
          : {}),
        ...("expectedParentSha" in deliveryCommitOutcome
          ? {
              expectedParentSha: deliveryCommitOutcome.expectedParentSha,
              actualParentSha: deliveryCommitOutcome.actualParentSha,
            }
          : {}),
        ...("expectedCommitSha" in deliveryCommitOutcome
          ? { expectedCommitSha: deliveryCommitOutcome.expectedCommitSha, actualHeadSha: deliveryCommitOutcome.actualHeadSha }
          : {}),
        ...("stage" in deliveryCommitOutcome ? { stage: deliveryCommitOutcome.stage } : {}),
      });
      return { ok: false, reason: `delivery_commit_${deliveryCommitOutcome.reason}` };
    }

    logger.info("Accepted execution run loaded and validated successfully.", {
      ...safeIdentifiers,
      headSha,
      workingTree: "changes_detected",
      deliveryBranch: deliveryBranchOutcome.branchName,
      deliveryCommitSha: deliveryCommitOutcome.commitSha,
    });
    return {
      ok: true,
      claimed: true,
      workingTree: "changes_detected",
      deliveryBranch: deliveryBranchOutcome.branchName,
      deliveryCommitSha: deliveryCommitOutcome.commitSha,
    };
  } finally {
    await workspaceOutcome.cleanup();
  }
}
