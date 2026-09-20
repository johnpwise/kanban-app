import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

import { dispatchMessageSchema } from "./dispatchMessage";

/**
 * The validated immutable execution intent carried over from the dispatch message, kept separate
 * from lifecycle metadata (status/acceptedAt/etc.) so a future launcher can read it without
 * depending on acceptance bookkeeping fields. Derived from `dispatchMessageSchema` (not
 * duplicated) so the two contracts cannot silently drift apart.
 */
export const executionRunInputSchema = dispatchMessageSchema.omit({
  projectId: true,
  cardId: true,
  executionRequestId: true,
  correlationId: true,
});

/**
 * Shape of an `executionRuns/{executionRequestId}` Firestore document. Only `status: "accepted"`
 * is modelled in this increment — later stages introduce further statuses.
 */
export const executionRunDocumentSchema = z.object({
  executionRequestId: z.string().min(1),
  correlationId: z.string().min(1),
  projectId: z.string().min(1),
  cardId: z.string().min(1),
  status: z.literal("accepted"),
  acceptedAt: z.instanceof(Timestamp),
  firstMessageId: z.string().min(1).optional(),
  input: executionRunInputSchema,
});

export type ExecutionRunInput = z.infer<typeof executionRunInputSchema>;
export type ExecutionRunDocument = z.infer<typeof executionRunDocumentSchema>;
