import { parseExecutionRunDocument } from "./schemas/executionRunDocument";

import type { ObserveDeliveryCiStatus, ObserveDeliveryCiStatusOutcome } from "./deliveryCiObservation";
import type { ExecutionRunRepository } from "./executionRunRepository";
import type { ExecutorLogger } from "./runExecutor";

type ObservationFailure = Extract<ObserveDeliveryCiStatusOutcome, { ok: false }>;

export interface DeliveryCiControllerPolicy {
  /** Hard bound on the number of `observe()` calls this run of the controller will make. */
  maxObservations: number;
  /** Delay passed to the injected `wait` between two consecutive `pending` observations. */
  delayMs: number;
}

export interface RunDeliveryCiControllerParams {
  executionRunId: string;
  /** Reused unmodified — only `loadExecutionRunData` is called; never a write. */
  repository: ExecutionRunRepository;
  /** The existing one-shot primitive (`fetchImpl`/`mintCredential` already bound at composition). */
  observe: ObserveDeliveryCiStatus;
  /** Injected so tests are deterministic and perform no real sleeping. */
  wait: (delayMs: number) => Promise<void>;
  policy: DeliveryCiControllerPolicy;
  logger?: ExecutorLogger;
}

export type DeliveryCiControllerOutcome =
  | { outcome: "execution_run_load_error" }
  | { outcome: "execution_run_not_found" }
  | { outcome: "execution_run_invalid" }
  | { outcome: "delivery_missing" }
  | { outcome: "ci_succeeded"; runId: number; htmlUrl: string; observationCount: number }
  | { outcome: "ci_failed"; runId: number; htmlUrl: string; conclusion: string; observationCount: number }
  | ({ outcome: "observation_failed"; observationCount: number } & Omit<ObservationFailure, "ok">)
  | { outcome: "observation_error"; observationCount: number }
  | { outcome: "exhausted"; observationCount: number }
  | { outcome: "ci_result_persistence_error"; observationCount: number }
  | { outcome: "ci_result_conflict"; observationCount: number };

/**
 * Bounded orchestration boundary over the existing one-shot `observeDeliveryCiStatus()` primitive.
 * Derives its authoritative repository/commit identity from the durably persisted
 * `executionRuns/{id}.delivery` record — never from branch HEAD, PR identity, `sourceRevision`, or
 * a caller-supplied value — then repeatedly observes only while CI remains `pending`, bounded by
 * `policy.maxObservations`. This is the first asynchronous lifecycle step after the coding
 * executor (`runExecutor`) has already exited; it does not run inside that process and never polls
 * from it. Never mutates GitHub. A genuine terminal observation is durably recorded via
 * `repository.recordCiResult` (anchored to the same `delivery.commitSha`, never `sourceRevision.
 * headSha`) before `ci_succeeded`/`ci_failed` is ever reported — persistence failure or conflict is
 * reported as its own distinct, fail-closed outcome instead.
 */
export async function runDeliveryCiController(
  params: RunDeliveryCiControllerParams,
): Promise<DeliveryCiControllerOutcome> {
  const { executionRunId, repository, observe, wait, policy, logger } = params;

  let data: unknown;
  try {
    data = await repository.loadExecutionRunData(executionRunId);
  } catch {
    logger?.error("Unexpected failure loading the persisted execution run.", { executionRunId });
    return { outcome: "execution_run_load_error" };
  }
  if (data === undefined) {
    logger?.error("Cannot observe CI: no such execution run.", { executionRunId });
    return { outcome: "execution_run_not_found" };
  }

  let run;
  try {
    run = parseExecutionRunDocument(executionRunId, data);
  } catch {
    logger?.error("Cannot observe CI: the persisted execution run document failed schema validation.", {
      executionRunId,
    });
    return { outcome: "execution_run_invalid" };
  }

  if (!run.delivery) {
    logger?.error("Cannot observe CI: no durable delivery is persisted for this execution run yet.", {
      executionRunId,
    });
    return { outcome: "delivery_missing" };
  }

  const { commitSha: deliveryCommitSha } = run.delivery;
  const safeIdentifiers = { executionRunId, repository: run.input.repository, deliveryCommitSha };

  let observationCount = 0;
  for (let attempt = 1; attempt <= policy.maxObservations; attempt++) {
    let observation: ObserveDeliveryCiStatusOutcome;
    try {
      observation = await observe({ repository: run.input.repository, deliveryCommitSha });
    } catch {
      observationCount++;
      logger?.error("Unexpected failure observing CI.", { ...safeIdentifiers, observationCount });
      return { outcome: "observation_error", observationCount };
    }
    observationCount++;

    if (!observation.ok) {
      const failureFields = {
        reason: observation.reason,
        ...("credentialReason" in observation ? { credentialReason: observation.credentialReason } : {}),
        ...("httpStatus" in observation ? { httpStatus: observation.httpStatus } : {}),
      };
      logger?.error("CI observation failed.", { ...safeIdentifiers, observationCount, ...failureFields });
      return { outcome: "observation_failed", observationCount, ...failureFields };
    }

    if (observation.state === "succeeded" || observation.state === "failed") {
      let recordCiResultOutcome;
      try {
        recordCiResultOutcome = await repository.recordCiResult(executionRunId, {
          commitSha: deliveryCommitSha,
          state: observation.state,
          runId: observation.runId,
          htmlUrl: observation.htmlUrl,
          ...(observation.state === "failed" ? { conclusion: observation.conclusion } : {}),
        });
      } catch {
        logger?.error("Unexpected failure durably persisting the terminal CI result.", {
          ...safeIdentifiers,
          observationCount,
        });
        return { outcome: "ci_result_persistence_error", observationCount };
      }

      if (recordCiResultOutcome.outcome === "conflict") {
        logger?.error("A conflicting CI result is already durably persisted for this execution run.", {
          ...safeIdentifiers,
          observationCount,
        });
        return { outcome: "ci_result_conflict", observationCount };
      }

      if (observation.state === "succeeded") {
        logger?.info("CI succeeded for the verified ADA delivery commit.", { ...safeIdentifiers, observationCount });
        return { outcome: "ci_succeeded", runId: observation.runId, htmlUrl: observation.htmlUrl, observationCount };
      }

      logger?.error("CI failed for the verified ADA delivery commit.", {
        ...safeIdentifiers,
        observationCount,
        conclusion: observation.conclusion,
      });
      return {
        outcome: "ci_failed",
        runId: observation.runId,
        htmlUrl: observation.htmlUrl,
        conclusion: observation.conclusion,
        observationCount,
      };
    }

    // state: "pending" — wait before the next attempt only if one remains.
    if (attempt < policy.maxObservations) {
      await wait(policy.delayMs);
    }
  }

  logger?.error("Exhausted the bounded CI observation window while CI remained pending.", {
    ...safeIdentifiers,
    observationCount,
  });
  return { outcome: "exhausted", observationCount };
}
