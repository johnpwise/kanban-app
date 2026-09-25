import { z } from "zod";

/**
 * Deliberately not derived from or merged into `functions/src/schemas/executionRunDocument.ts`
 * (`status: z.literal("accepted")` only), for the same reason `deliveryEligibility.ts`'s own
 * standalone schema is: `status` here is executor/Functions-lifecycle-owned across several
 * possible values, never re-validated as a literal on the Functions side — this trigger needs
 * only to detect a `ci_succeeded` transition, not model the full status enum, so it stays a
 * narrow, standalone schema. A non-string `status` fails closed via `z.string()`.
 */
const mergeCompletionEligibilityDocumentSchema = z.object({
  executionRequestId: z.string().min(1),
  status: z.string(),
});

function parseMatchingDocument(documentId: string, data: unknown) {
  const parsed = mergeCompletionEligibilityDocumentSchema.safeParse(data);
  if (!parsed.success || parsed.data.executionRequestId !== documentId) {
    return undefined;
  }
  return parsed.data;
}

export interface MergeCompletionEligibilityDecisionParams {
  /** Firestore document id from the trigger path (`executionRuns/{executionRequestId}`). */
  documentId: string;
  /** The update trigger event's `before` snapshot data, or `undefined` if it carried none. */
  before: unknown;
  /** The update trigger event's `after` snapshot data, or `undefined` if it carried none. */
  after: unknown;
}

/**
 * True only for a genuine `status: (not "ci_succeeded") → "ci_succeeded"` transition on a
 * document whose id matches its own `executionRequestId` on both sides of the update —
 * fail-closed (`false`) for a malformed snapshot, an id mismatch, a missing snapshot, a status
 * that was already `ci_succeeded` before the update (including a later unrelated or `merge`
 * write — a non-transitioning snapshot), or a status that is not `ci_succeeded` after it (e.g. a
 * transition into `ci_failed`, which must never launch merge completion).
 */
export function isCiSucceededEligibleForMergeControl({
  documentId,
  before,
  after,
}: MergeCompletionEligibilityDecisionParams): boolean {
  const afterRun = parseMatchingDocument(documentId, after);
  if (afterRun === undefined || afterRun.status !== "ci_succeeded") {
    return false;
  }

  const beforeRun = parseMatchingDocument(documentId, before);
  if (beforeRun === undefined || beforeRun.status === "ci_succeeded") {
    return false;
  }

  return true;
}
