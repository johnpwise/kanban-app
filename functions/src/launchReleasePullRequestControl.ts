import { isReleaseStartCompletionEligibleForPullRequestControl } from "./releasePullRequestCompletionEligibility";

export interface LaunchAdaReleasePullRequestControllerJobResult {
  /** The Cloud Run long-running operation's resource name, when the client library returns one. */
  operationName?: string;
}

/**
 * Injected seam over the Cloud Run Admin API so this handler's orchestration can be unit tested
 * without calling Google Cloud. The production implementation lives in
 * `adaReleasePullRequestControllerJobLauncher.ts`. `releaseIntentId` is the only override this
 * launcher ever sends — no `CODEX_*` configuration is propagated, since the release-pull-request-
 * controller runtime never invokes Codex.
 */
export type LaunchAdaReleasePullRequestControllerJob = (params: {
  releaseIntentId: string;
}) => Promise<LaunchAdaReleasePullRequestControllerJobResult>;

export interface LaunchReleasePullRequestControlLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface LaunchReleasePullRequestControlParams {
  /** Firestore document id from the trigger path (`releaseIntents/{releaseIntentId}`) — also the
   * exact, only launch authority passed through to the Job (see `launchJob` below). */
  documentId: string;
  /** The update trigger event's `before` snapshot data, or `undefined` if it carried none. */
  before: unknown;
  /** The update trigger event's `after` snapshot data, or `undefined` if it carried none. */
  after: unknown;
  /** Firestore event id, included in logs for correlation with Cloud Logging. */
  eventId: string;
  launchJob: LaunchAdaReleasePullRequestControllerJob;
  logger: LaunchReleasePullRequestControlLogger;
}

type LaunchErrorClassification = "permission" | "missing-resource" | "invalid-configuration";

/**
 * Same gRPC-code classification as `launchAdaMergeControl.ts`/`launchReleaseStart.ts`'s
 * `classifyLaunchError`: PERMISSION_DENIED (7), NOT_FOUND (5), INVALID_ARGUMENT (3),
 * FAILED_PRECONDITION (9) will never succeed by retrying. Everything else (network, quota,
 * deadline, unrecognized shape) is transient.
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
 * `onDocumentUpdated` handler body for `releaseIntents/{releaseIntentId}`, mirroring
 * `launchAdaMergeControl.ts`'s shape exactly but for the release-intent `start` absent→present
 * transition instead of a `ci_succeeded` status transition. Most updates on this document are
 * *not* that transition — an unrelated field write, a `start` that was already present, and the
 * later `pullRequests` persistence this stage's own controller performs all pass through this same
 * trigger; `isReleaseStartCompletionEligibleForPullRequestControl` fails closed to a no-launch skip
 * for all of them.
 *
 * Never rereads any other Firestore data, and never mutates Firestore — requests one Cloud Run Job
 * execution through the injected `launchJob` and never awaits its completion. The
 * release-pull-request-controller runtime re-verifies eligibility fresh against live GitHub state
 * itself (`evaluateReleasePullRequestEligibility`); this handler's only job is detecting the
 * durable transition and requesting that a controller execution happen. `documentId` is passed as
 * `releaseIntentId` directly — the release intent id *is* the Firestore document id, so no
 * derivation is needed here (unlike `launchReleaseStart.ts`, which derives it from a different
 * document's `version` field).
 *
 * A permanent failure (permission/missing-resource/invalid-configuration) is logged and swallowed
 * so the platform acknowledges the event instead of retrying forever. Any other error is rethrown
 * so the platform redelivers — safe because a redelivered launch converges on the same durable
 * per-target PR idempotency contract in `recordReleasePullRequestResult`, not a new dedup mechanism
 * here.
 */
export async function launchReleasePullRequestControl({
  documentId,
  before,
  after,
  eventId,
  launchJob,
  logger,
}: LaunchReleasePullRequestControlParams): Promise<void> {
  if (!isReleaseStartCompletionEligibleForPullRequestControl({ documentId, before, after })) {
    logger.info(
      "ADA release intent update is not a start-completion transition; skipping release-pull-request-controller launch.",
      { documentId, eventId },
    );
    return;
  }

  let result: LaunchAdaReleasePullRequestControllerJobResult;
  try {
    result = await launchJob({ releaseIntentId: documentId });
  } catch (error) {
    const classification = classifyLaunchError(error);
    if (classification === "transient") {
      throw error;
    }

    logger.error(
      "ADA release-pull-request-controller Cloud Run Job launch failed with a permanent error; acknowledging without retry.",
      { documentId, eventId, classification },
    );
    return;
  }

  logger.info("ADA release-pull-request-controller Cloud Run Job launch requested.", {
    releaseIntentId: documentId,
    eventId,
    operationName: result.operationName,
  });
}
