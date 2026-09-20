import { z } from "zod";

import { mapToDispatchMessage } from "./mapToDispatchMessage";

export interface DispatchLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export type PublishAttributes = Record<string, string>;

export type PublishFn = (data: Buffer, attributes: PublishAttributes) => Promise<string>;

export interface DispatchExecutionRequestParams {
  executionRequestId: string;
  data: unknown;
  publish: PublishFn;
  logger: DispatchLogger;
}

/**
 * Validates an execution request snapshot, maps it to the versioned dispatch message, and
 * publishes it. Permanently invalid input (fails validation) is logged and never published — it
 * is not retried. A publish failure is logged and rethrown so the Cloud Functions platform's
 * at-least-once retry behaviour applies (treated as transient).
 *
 * Never touches Firestore: this function has no Firestore client, so it cannot mutate the Card
 * or the Execution Request document.
 */
export async function dispatchExecutionRequest({
  executionRequestId,
  data,
  publish,
  logger,
}: DispatchExecutionRequestParams): Promise<void> {
  let message;
  try {
    message = mapToDispatchMessage(executionRequestId, data);
  } catch (error) {
    logger.error("ADA execution request failed validation; message was not published.", {
      executionRequestId,
      reason: error instanceof z.ZodError ? error.issues.map((issue) => issue.message) : "unknown validation error",
    });
    return;
  }

  const buffer = Buffer.from(JSON.stringify(message), "utf8");
  const attributes: PublishAttributes = {
    schemaVersion: String(message.schemaVersion),
    eventType: message.eventType,
    executionRequestId: message.executionRequestId,
    correlationId: message.correlationId,
  };

  let messageId: string;
  try {
    messageId = await publish(buffer, attributes);
  } catch (error) {
    logger.error("ADA execution request publish failed; will be retried by the platform.", {
      executionRequestId: message.executionRequestId,
      correlationId: message.correlationId,
      reason: error instanceof Error ? error.message : "unknown publish error",
    });
    throw error;
  }

  logger.info("ADA execution request dispatched to Pub/Sub.", {
    executionRequestId: message.executionRequestId,
    correlationId: message.correlationId,
    messageId,
  });
}
