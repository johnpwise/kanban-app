import { executionRunDocumentSchema } from "./schemas/executionRunDocument";

export interface LaunchAdaExecutorJobResult {
  /** The Cloud Run long-running operation's resource name, when the client library returns one. */
  operationName?: string;
}

/**
 * Injected seam over the Cloud Run Admin API so this handler's orchestration can be unit tested
 * without calling Google Cloud. The production implementation lives in `adaExecutorJobLauncher.ts`.
 */
export type LaunchAdaExecutorJob = (params: { executionRequestId: string }) => Promise<LaunchAdaExecutorJobResult>;

export interface LaunchExecutionRunLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface LaunchExecutionRunParams {
  /** Firestore document id from the trigger path (`executionRuns/{executionRequestId}`). */
  documentId: string;
  /** Raw event document data, or `undefined` when the event carried no document. */
  data: unknown;
  /** Firestore event id, included in logs for correlation with Cloud Logging. */
  eventId: string;
  launchJob: LaunchAdaExecutorJob;
  logger: LaunchExecutionRunLogger;
}

type LaunchErrorClassification = "permission" | "missing-resource" | "invalid-configuration";

/**
 * gRPC status codes (google-gax `GoogleError.code`) that indicate a launch will never succeed by
 * retrying: PERMISSION_DENIED (7), NOT_FOUND (5), INVALID_ARGUMENT (3), FAILED_PRECONDITION (9).
 * Every other error (network, quota, deadline, or an unrecognized shape) is treated as transient
 * so it is never silently dropped.
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
 * `onDocumentCreated` handler body for `executionRuns/{executionRequestId}`. Reads only the
 * trigger's own event payload — never rereads Project/Card/Execution Request data, and never
 * mutates Firestore — then requests one Cloud Run Job execution through the injected `launchJob`.
 * Never awaits Job completion: `launchJob` is expected to resolve once Google Cloud accepts the
 * launch request.
 *
 * A permanent failure (schema-invalid document, id/body mismatch, or a permission/missing-resource/
 * invalid-configuration launch error) is logged and swallowed so the platform acknowledges the
 * event instead of retrying forever. Any other error is rethrown so the platform redelivers.
 */
export async function launchExecutionRun({
  documentId,
  data,
  eventId,
  launchJob,
  logger,
}: LaunchExecutionRunParams): Promise<void> {
  if (data === undefined) {
    logger.warn("ADA execution run creation event had no document data; skipping launch.", { documentId, eventId });
    return;
  }

  const parsed = executionRunDocumentSchema.safeParse(data);
  if (!parsed.success) {
    logger.error("ADA execution run document failed validation; acknowledging without launching.", {
      documentId,
      eventId,
    });
    return;
  }

  const run = parsed.data;

  if (run.executionRequestId !== documentId) {
    logger.error(
      "ADA execution run document id does not match its executionRequestId field; acknowledging without launching.",
      { documentId, eventId },
    );
    return;
  }

  let result: LaunchAdaExecutorJobResult;
  try {
    result = await launchJob({ executionRequestId: run.executionRequestId });
  } catch (error) {
    const classification = classifyLaunchError(error);
    if (classification === "transient") {
      throw error;
    }

    logger.error("ADA Cloud Run Job launch failed with a permanent error; acknowledging without retry.", {
      documentId,
      eventId,
      classification,
    });
    return;
  }

  logger.info("ADA Cloud Run Job launch requested.", {
    executionRequestId: run.executionRequestId,
    correlationId: run.correlationId,
    eventId,
    operationName: result.operationName,
  });
}
