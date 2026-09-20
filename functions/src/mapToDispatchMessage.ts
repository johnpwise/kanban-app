import { z } from "zod";

import { DISPATCH_EVENT_TYPE, DISPATCH_SCHEMA_VERSION, dispatchMessageSchema } from "./schemas/dispatchMessage";
import { executionRequestDocumentDataSchema } from "./schemas/executionRequestDocument";

import type { DispatchMessage } from "./schemas/dispatchMessage";

const executionRequestIdSchema = z.string().min(1);

/**
 * Maps a Firestore document ID + immutable `executionRequests/{id}` document data to the
 * versioned Pub/Sub dispatch message contract. Pure and deterministic: the same inputs always
 * produce the same output, so at-least-once redelivery of the same document is safe to re-map.
 *
 * Throws a ZodError when `executionRequestId` or `data` is invalid — the caller is responsible
 * for treating that as permanently invalid input (log, do not publish, do not retry).
 */
export function mapToDispatchMessage(executionRequestId: string, data: unknown): DispatchMessage {
  const id = executionRequestIdSchema.parse(executionRequestId);
  const snapshot = executionRequestDocumentDataSchema.parse(data);

  return dispatchMessageSchema.parse({
    schemaVersion: DISPATCH_SCHEMA_VERSION,
    eventType: DISPATCH_EVENT_TYPE,
    executionRequestId: id,
    correlationId: id,
    ...snapshot,
  });
}
