import { isReleasePullRequestPairCompletionEligibleForCiControl } from "./releaseCiControlEligibility";

export interface LaunchAdaReleaseCiControllerJobResult {
  /** The Cloud Run long-running operation's resource name, when the client library returns one. */
  operationName?: string;
}

/**
 * Injected seam over the Cloud Run Admin API so this handler's orchestration can be unit tested
 * without calling Google Cloud. The production implementation lives in
 * `adaReleaseCiControllerJobLauncher.ts`. `releaseIntentId` is the only override this launcher ever
 * sends — no `CODEX_*` configuration is propagated, since the release-ci-controller runtime never
 * invokes Codex.
 */
export type LaunchAdaReleaseCiControllerJob = (params: {
  releaseIntentId: string;
}) => Promise<LaunchAdaReleaseCiControllerJobResult>;

export interface LaunchReleaseCiControlLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface LaunchReleaseCiControlParams {
  /** Firestore document id from the trigger path (`releaseIntents/{releaseIntentId}`) — also the
   * exact, only launch authority passed through to the Job (see `launchJob` below). */
  documentId: string;
  /** The update trigger event's `before` snapshot data, or `undefined` if it carried none. */
  before: unknown;
  /** The update trigger event's `after` snapshot data, or `undefined` if it carried none. */
  after: unknown;
  /** Firestore event id, included in logs for correlation with Cloud Logging. */
  eventId: string;
  launchJob: LaunchAdaReleaseCiControllerJob;
  logger: LaunchReleaseCiControlLogger;
}

type LaunchErrorClassification = "permission" | "missing-resource" | "invalid-configuration";

/**
 * Same gRPC-code classification as `launchReleasePullRequestControl.ts`/`launchAdaMergeControl.ts`'s
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
 * `launchReleasePullRequestControl.ts`'s shape but for the whole release-PR-pair-completion
 * transition (both `pullRequests.main` and `pullRequests.develop` becoming present) instead of the
 * release-intent `start` transition — checked via `isReleasePullRequestPairCompletionEligibleForCiControl`,
 * which requires both durable PR identities to exist and not have already both existed before the
 * update. Most updates on this document are *not* that transition — an unrelated field write, a
 * pair that is still incomplete, a pair that was already complete, and the later `ci` persistence
 * this stage's own controller performs all pass through this same trigger and are skipped.
 *
 * Never rereads any other Firestore data, and never mutates Firestore — requests at most one Cloud
 * Run Job execution per eligible event through the injected `launchJob` and never awaits its
 * completion. The release-ci-controller runtime re-verifies both PR identities fresh against live
 * GitHub state itself (`releasePullRequestCiObservation.ts`) before ever observing CI; this
 * handler's only job is detecting the durable pair-completion transition and requesting that one
 * controller execution happen. The controller itself independently handles both targets within the
 * same execution (PR #67).
 *
 * A permanent failure (permission/missing-resource/invalid-configuration) is logged and swallowed
 * so the platform acknowledges the event instead of retrying forever; a transient error is
 * rethrown so the platform redelivers the event — safe, since a redundant launch on redelivery is a
 * no-op at the controller level, not a new dedup mechanism needed here.
 */
export async function launchReleaseCiControl({
  documentId,
  before,
  after,
  eventId,
  launchJob,
  logger,
}: LaunchReleaseCiControlParams): Promise<void> {
  const eligible = isReleasePullRequestPairCompletionEligibleForCiControl({ documentId, before, after });

  if (!eligible) {
    logger.info(
      "ADA release intent update is not a release-PR-pair-completion transition; skipping release-ci-controller launch.",
      { documentId, eventId },
    );
    return;
  }

  let result: LaunchAdaReleaseCiControllerJobResult;
  try {
    result = await launchJob({ releaseIntentId: documentId });
  } catch (error) {
    const classification = classifyLaunchError(error);
    if (classification === "transient") {
      throw error;
    }

    logger.error(
      "ADA release-ci-controller Cloud Run Job launch failed with a permanent error; acknowledging without retry.",
      { documentId, eventId, classification },
    );
    return;
  }

  logger.info("ADA release-ci-controller Cloud Run Job launch requested.", {
    releaseIntentId: documentId,
    eventId,
    operationName: result.operationName,
  });
}
