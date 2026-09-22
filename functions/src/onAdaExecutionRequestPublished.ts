import { acceptExecutionRun } from "./acceptExecutionRun";
import { DispatchMessageValidationError, decodeDispatchMessage } from "./decodeDispatchMessage";

import type { AcceptExecutionRunLogger, RunAcceptExecutionRunTransaction } from "./acceptExecutionRun";

export interface HandleAdaExecutionRequestPublishedParams {
  /** Base64-encoded Pub/Sub message body, as delivered on `event.data.message.data`. */
  data: string;
  attributes: Record<string, string>;
  /** The first Pub/Sub transport message id seen for this delivery, when available. */
  transportMessageId?: string;
  /**
   * Builds the Firestore transaction for a given execution run id. Takes a factory rather than an
   * already-bound transaction so the target document path is always derived from the *validated*
   * message body's `executionRequestId`, never from the unvalidated Pub/Sub attribute.
   */
  createRunTransaction: (executionRequestId: string) => RunAcceptExecutionRunTransaction;
  logger: AcceptExecutionRunLogger;
}

/**
 * Composes decode -> validate -> idempotently accept for a Pub/Sub `ada.execution.requested`
 * message. A permanent validation failure is logged and swallowed so the platform acknowledges
 * the message instead of retrying it forever; any other failure (Firestore/transaction) is
 * rethrown so the platform redelivers.
 */
export async function handleAdaExecutionRequestPublished({
  data,
  attributes,
  transportMessageId,
  createRunTransaction,
  logger,
}: HandleAdaExecutionRequestPublishedParams): Promise<void> {
  let message;
  try {
    message = decodeDispatchMessage(data, attributes);
  } catch (error) {
    if (error instanceof DispatchMessageValidationError) {
      logger.error("ADA Pub/Sub message failed validation; acknowledging without creating an execution run.", {
        reason: error.reason,
        attributes,
      });
      return;
    }
    throw error;
  }

  await acceptExecutionRun({
    message,
    firstMessageId: transportMessageId,
    runTransaction: createRunTransaction(message.executionRequestId),
    logger,
  });
}
