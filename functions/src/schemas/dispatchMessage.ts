import { z } from "zod";

import { executionRequestDocumentDataSchema } from "./executionRequestDocument";

export const DISPATCH_SCHEMA_VERSION = 1 as const;
export const DISPATCH_EVENT_TYPE = "ada.execution.requested" as const;

/**
 * Versioned, runtime-validated Pub/Sub message contract for a dispatched ADA execution request.
 * Kept independent from any Pub/Sub-specific response type (see mapToDispatchMessage.ts).
 */
export const dispatchMessageSchema = executionRequestDocumentDataSchema.extend({
  schemaVersion: z.literal(DISPATCH_SCHEMA_VERSION),
  eventType: z.literal(DISPATCH_EVENT_TYPE),
  executionRequestId: z.string().min(1),
  correlationId: z.string().min(1),
});

export type DispatchMessage = z.infer<typeof dispatchMessageSchema>;
