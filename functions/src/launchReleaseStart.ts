import { releaseRequestDocumentSchema } from "./schemas/releaseRequestDocument";

export interface LaunchAdaReleaseControllerJobResult {
  /** The Cloud Run long-running operation's resource name, when the client library returns one. */
  operationName?: string;
}

/**
 * Injected seam over the Cloud Run Admin API so this handler's orchestration can be unit tested
 * without calling Google Cloud. The production implementation lives in
 * `adaReleaseControllerJobLauncher.ts`. `releaseIntentId` is the only override this launcher ever
 * sends — no `CODEX_*` configuration is propagated, since the release-controller runtime never
 * invokes Codex.
 */
export type LaunchAdaReleaseControllerJob = (params: {
  releaseIntentId: string;
}) => Promise<LaunchAdaReleaseControllerJobResult>;

export interface LaunchReleaseStartLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface LaunchReleaseStartParams {
  /** Firestore document id from the trigger path (`releaseRequests/{releaseRequestId}`). */
  documentId: string;
  /** Raw event document data, or `undefined` when the event carried no document. */
  data: unknown;
  /** Firestore event id, included in logs for correlation with Cloud Logging. */
  eventId: string;
  /** This launcher's own trusted repository configuration (`adaReleaseControllerRunLauncherConfig.ts`'s
   * `adaReleaseRepository`) — never read from the request document. The `ada-release-controller`
   * Job independently holds the same value as its own deploy-time configuration; deriving
   * `releaseIntentId` from it here (rather than passing `version` through as a second override)
   * keeps this launcher's only per-execution override to `releaseIntentId`, matching every other
   * ADA launcher's single-override contract. */
  trustedRepository: string;
  launchJob: LaunchAdaReleaseControllerJob;
  logger: LaunchReleaseStartLogger;
}

type LaunchErrorClassification = "permission" | "missing-resource" | "invalid-configuration";

/**
 * Same gRPC-code classification as `launchExecutionRun.ts`/`launchAdaMergeControl.ts`'s
 * `classifyLaunchError`: PERMISSION_DENIED (7), NOT_FOUND (5), INVALID_ARGUMENT (3),
 * FAILED_PRECONDITION (9) will never succeed by retrying. Everything else (network, quota,
 * deadline, unrecognized shape) is transient. No Codex-specific special case, unlike
 * `launchExecutionRun.ts`'s own classifier: this runtime never invokes Codex, so no
 * `AdaCodexModelConfigError` can ever be thrown here.
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
 * Firestore document ids cannot contain `/`; `repository` is always `owner/repo`. Deliberately
 * duplicated (one line) from `executor/src/schemas/releaseIntentDocument.ts`'s
 * `deriveReleaseIntentId` rather than imported: `functions/` and `executor/` are separate npm
 * packages with no workspace linking (confirmed during planning), so nothing is shared by import,
 * only by this repo's existing convention of small, decoupled duplication for stable, trivial,
 * non-security-sensitive logic — unlike the GitHub credential/observation logic, which stays
 * exclusively in `executor/` (see `releaseControllerMain.ts`'s own docstring).
 */
function deriveReleaseIntentId(repository: string, version: string): string {
  return `${repository.replace("/", "__")}--${version}`;
}

/**
 * `onDocumentCreated` handler body for `releaseRequests/{releaseRequestId}`. Reads only the
 * trigger's own event payload and this launcher's own trusted repository configuration — never a
 * GitHub credential, never any other Firestore document — then requests one Cloud Run Job
 * execution through the injected `launchJob`. Never awaits Job completion.
 *
 * A permanent failure (schema-invalid document, id/body mismatch, or a permission/missing-resource/
 * invalid-configuration launch error) is logged and swallowed so the platform acknowledges the
 * event instead of retrying forever. Any other error is rethrown so the platform redelivers —
 * safe because a redelivered launch computes the identical deterministic `releaseIntentId` and
 * converges on the same durable idempotency contracts in `recordReleaseIntent`/
 * `recordReleaseStartResult`, not a new dedup mechanism here.
 */
export async function launchReleaseStart({
  documentId,
  data,
  eventId,
  trustedRepository,
  launchJob,
  logger,
}: LaunchReleaseStartParams): Promise<void> {
  if (data === undefined) {
    logger.warn("ADA release request creation event had no document data; skipping launch.", { documentId, eventId });
    return;
  }

  const parsed = releaseRequestDocumentSchema.safeParse(data);
  if (!parsed.success) {
    logger.error("ADA release request document failed validation; acknowledging without launching.", {
      documentId,
      eventId,
    });
    return;
  }

  const request = parsed.data;

  if (request.releaseRequestId !== documentId) {
    logger.error(
      "ADA release request document id does not match its releaseRequestId field; acknowledging without launching.",
      { documentId, eventId },
    );
    return;
  }

  const releaseIntentId = deriveReleaseIntentId(trustedRepository, request.version);

  let result: LaunchAdaReleaseControllerJobResult;
  try {
    result = await launchJob({ releaseIntentId });
  } catch (error) {
    const classification = classifyLaunchError(error);
    if (classification === "transient") {
      throw error;
    }

    logger.error("ADA release-controller Cloud Run Job launch failed with a permanent error; acknowledging without retry.", {
      documentId,
      eventId,
      classification,
    });
    return;
  }

  logger.info("ADA release-controller Cloud Run Job launch requested.", {
    releaseRequestId: request.releaseRequestId,
    releaseIntentId,
    eventId,
    operationName: result.operationName,
  });
}
