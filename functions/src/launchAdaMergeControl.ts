import { isCiSucceededEligibleForMergeControl } from "./mergeCompletionEligibility";

export interface LaunchAdaMergeControllerJobResult {
  /** The Cloud Run long-running operation's resource name, when the client library returns one. */
  operationName?: string;
}

/**
 * Injected seam over the Cloud Run Admin API so this handler's orchestration can be unit tested
 * without calling Google Cloud. The production implementation lives in
 * `adaMergeControllerJobLauncher.ts`. `executionRequestId` is the only override this launcher
 * ever sends — no `CODEX_*` configuration is propagated, since the merge-controller runtime never
 * invokes Codex.
 */
export type LaunchAdaMergeControllerJob = (params: {
  executionRequestId: string;
}) => Promise<LaunchAdaMergeControllerJobResult>;

export interface LaunchAdaMergeControlLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface LaunchAdaMergeControlParams {
  /** Firestore document id from the trigger path (`executionRuns/{executionRequestId}`). */
  documentId: string;
  /** The update trigger event's `before` snapshot data, or `undefined` if it carried none. */
  before: unknown;
  /** The update trigger event's `after` snapshot data, or `undefined` if it carried none. */
  after: unknown;
  /** Firestore event id, included in logs for correlation with Cloud Logging. */
  eventId: string;
  launchJob: LaunchAdaMergeControllerJob;
  logger: LaunchAdaMergeControlLogger;
}

type LaunchErrorClassification = "permission" | "missing-resource" | "invalid-configuration";

/**
 * Same gRPC-code classification as `launchDeliveryCiControl.ts`'s `classifyLaunchError`:
 * PERMISSION_DENIED (7), NOT_FOUND (5), INVALID_ARGUMENT (3), FAILED_PRECONDITION (9) will never
 * succeed by retrying. Everything else (network, quota, deadline, unrecognized shape) is
 * transient.
 */
const PERMANENT_ERROR_CLASSIFICATION_BY_GRPC_CODE: Record<number, LaunchErrorClassification> = {
  3: "invalid-configuration",
  5: "missing-resource",
  7: "permission",
  9: "invalid-configuration",
};

function classifyLaunchError(error: unknown): LaunchErrorClassification | "transient" {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "number" && code in PERMANENT_ERROR_CLASSIFICATION_BY_GRPC_CODE) {
    return PERMANENT_ERROR_CLASSIFICATION_BY_GRPC_CODE[code];
  }
  return "transient";
}

/**
 * `onDocumentUpdated` handler body for `executionRuns/{executionRequestId}`, mirroring
 * `launchDeliveryCiControl.ts`'s shape exactly but for the `ci_succeeded` transition instead of
 * the delivery absent-to-present transition. Most updates on this document are *not* a
 * `ci_succeeded` transition — `claim`, `sourceRevision`, `delivery`, and later `merge` writes all
 * pass through this same trigger. A non-eligible update (including a malformed snapshot, an id
 * mismatch, or a transition into `ci_failed`) is therefore logged at `info`, not `error`: it is
 * the routine case, not a fault.
 *
 * Never rereads Project/Card/Execution Request data, and never mutates Firestore — requests one
 * Cloud Run Job execution through the injected `launchJob` and never awaits its completion. The
 * merge-controller runtime re-verifies eligibility fresh against live GitHub state itself
 * (`evaluateMergeEligibility`); this handler's only job is detecting the durable transition and
 * requesting that a controller execution happen.
 *
 * A permanent failure (permission/missing-resource/invalid-configuration) is logged and swallowed
 * so the platform acknowledges the event instead of retrying forever. Any other error is rethrown
 * so the platform redelivers — safe because a redelivered launch converges on the same durable
 * merge-identity idempotency contract in `recordMergeResult`, not a new dedup mechanism here.
 */
export async function launchAdaMergeControl({
  documentId,
  before,
  after,
  eventId,
  launchJob,
  logger,
}: LaunchAdaMergeControlParams): Promise<void> {
  if (!isCiSucceededEligibleForMergeControl({ documentId, before, after })) {
    logger.info("ADA execution run update is not a ci_succeeded transition; skipping merge-controller launch.", {
      documentId,
      eventId,
    });
    return;
  }

  let result: LaunchAdaMergeControllerJobResult;
  try {
    result = await launchJob({ executionRequestId: documentId });
  } catch (error) {
    const classification = classifyLaunchError(error);
    if (classification === "transient") {
      throw error;
    }

    logger.error("ADA merge-controller Cloud Run Job launch failed with a permanent error; acknowledging without retry.", {
      documentId,
      eventId,
      classification,
    });
    return;
  }

  logger.info("ADA merge-controller Cloud Run Job launch requested.", {
    executionRequestId: documentId,
    eventId,
    operationName: result.operationName,
  });
}
