import { isDeliveryEligibleForCiControl } from "./deliveryEligibility";

export interface LaunchAdaCiControllerJobResult {
  /** The Cloud Run long-running operation's resource name, when the client library returns one. */
  operationName?: string;
}

/**
 * Injected seam over the Cloud Run Admin API so this handler's orchestration can be unit tested
 * without calling Google Cloud. The production implementation lives in
 * `adaCiControllerJobLauncher.ts`. `executionRequestId` is the only override this launcher ever
 * sends — no `CODEX_*` configuration is propagated, since the CI-controller runtime never invokes
 * Codex.
 */
export type LaunchAdaCiControllerJob = (params: {
  executionRequestId: string;
}) => Promise<LaunchAdaCiControllerJobResult>;

export interface LaunchDeliveryCiControlLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface LaunchDeliveryCiControlParams {
  /** Firestore document id from the trigger path (`executionRuns/{executionRequestId}`). */
  documentId: string;
  /** The update trigger event's `before` snapshot data, or `undefined` if it carried none. */
  before: unknown;
  /** The update trigger event's `after` snapshot data, or `undefined` if it carried none. */
  after: unknown;
  /** Firestore event id, included in logs for correlation with Cloud Logging. */
  eventId: string;
  launchJob: LaunchAdaCiControllerJob;
  logger: LaunchDeliveryCiControlLogger;
}

type LaunchErrorClassification = "permission" | "missing-resource" | "invalid-configuration";

/**
 * Same gRPC-code classification as `launchExecutionRun.ts`'s `classifyLaunchError`: PERMISSION_DENIED
 * (7), NOT_FOUND (5), INVALID_ARGUMENT (3), FAILED_PRECONDITION (9) will never succeed by retrying.
 * Everything else (network, quota, deadline, unrecognized shape) is transient.
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
 * `onDocumentUpdated` handler body for `executionRuns/{executionRequestId}`. Unlike
 * `launchExecutionRun` (which treats every triggered event as an expected new run), most updates
 * on this document are *not* a delivery transition — `claim`, `sourceRevision`, and `ci` writes all
 * pass through this same trigger. A non-eligible update (including a malformed snapshot or an id
 * mismatch — `isDeliveryEligibleForCiControl` fails closed on both) is therefore logged at `info`,
 * not `error`: it is the routine case, not a fault.
 *
 * Never rereads Project/Card/Execution Request data, and never mutates Firestore — requests one
 * Cloud Run Job execution through the injected `launchJob` and never awaits its completion.
 *
 * A permanent failure (permission/missing-resource/invalid-configuration) is logged and swallowed
 * so the platform acknowledges the event instead of retrying forever. Any other error is rethrown
 * so the platform redelivers — safe because a redelivered launch converges on the same durable
 * `(commitSha, state)` idempotency contract in `recordCiResult`, not a new dedup mechanism here.
 */
export async function launchDeliveryCiControl({
  documentId,
  before,
  after,
  eventId,
  launchJob,
  logger,
}: LaunchDeliveryCiControlParams): Promise<void> {
  if (!isDeliveryEligibleForCiControl({ documentId, before, after })) {
    logger.info("ADA execution run update is not a delivery absent-to-present transition; skipping CI-controller launch.", {
      documentId,
      eventId,
    });
    return;
  }

  let result: LaunchAdaCiControllerJobResult;
  try {
    result = await launchJob({ executionRequestId: documentId });
  } catch (error) {
    const classification = classifyLaunchError(error);
    if (classification === "transient") {
      throw error;
    }

    logger.error("ADA CI-controller Cloud Run Job launch failed with a permanent error; acknowledging without retry.", {
      documentId,
      eventId,
      classification,
    });
    return;
  }

  logger.info("ADA CI-controller Cloud Run Job launch requested.", {
    executionRequestId: documentId,
    eventId,
    operationName: result.operationName,
  });
}
