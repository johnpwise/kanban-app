import { randomUUID } from "node:crypto";

import { noopInvokeCodingAgent } from "./codingAgentInvocation";
import { parseExecutorConfig } from "./config";
import { parseExecutionRunDocument } from "./schemas/executionRunDocument";

import type { InvokeCodingAgent } from "./codingAgentInvocation";
import type { ExecutionRunRepository } from "./executionRunRepository";
import type { MaterializeRepositoryWorkspace } from "./repositoryWorkspace";

export interface ExecutorLogger {
  info(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

export type ExecutorOutcome = { ok: true; claimed: boolean } | { ok: false; reason: string };

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
    } catch {
      logger.error("Unexpected failure invoking the coding agent.", safeIdentifiers);
      return { ok: false, reason: "coding_agent_invocation_error" };
    }

    logger.info("Accepted execution run loaded and validated successfully.", {
      ...safeIdentifiers,
      headSha,
    });
    return { ok: true, claimed: true };
  } finally {
    await workspaceOutcome.cleanup();
  }
}
