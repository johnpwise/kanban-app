import { z } from "zod";

/**
 * Deliberately not derived from or merged into `functions/src/schemas/executionRunDocument.ts`
 * (`status: z.literal("accepted")` only). `delivery` is executor-owned and never re-validated on
 * the Functions side (see that schema's docstring) — this trigger needs only to detect its
 * presence, not model its shape, so it stays a narrow, standalone schema. `delivery`'s inner
 * fields are intentionally left unvalidated (`passthrough`); only "is this an object" is checked,
 * which is enough to fail closed on a malformed value (e.g. a string) without duplicating the
 * executor-owned field rules.
 */
const deliveryEligibilityDocumentSchema = z.object({
  executionRequestId: z.string().min(1),
  delivery: z.object({}).passthrough().optional(),
});

function parseMatchingDocument(documentId: string, data: unknown) {
  const parsed = deliveryEligibilityDocumentSchema.safeParse(data);
  if (!parsed.success || parsed.data.executionRequestId !== documentId) {
    return undefined;
  }
  return parsed.data;
}

export interface DeliveryEligibilityDecisionParams {
  /** Firestore document id from the trigger path (`executionRuns/{executionRequestId}`). */
  documentId: string;
  /** The update trigger event's `before` snapshot data, or `undefined` if it carried none. */
  before: unknown;
  /** The update trigger event's `after` snapshot data, or `undefined` if it carried none. */
  after: unknown;
}

/**
 * True only for a genuine `delivery: absent → present` transition on a document whose id matches
 * its own `executionRequestId` on both sides of the update — fail-closed (`false`) for a malformed
 * snapshot, an id mismatch, a missing snapshot, delivery already present before the update
 * (including a later unrelated or `ci` write), or delivery still absent after it.
 */
export function isDeliveryEligibleForCiControl({
  documentId,
  before,
  after,
}: DeliveryEligibilityDecisionParams): boolean {
  const afterRun = parseMatchingDocument(documentId, after);
  if (afterRun === undefined || afterRun.delivery === undefined) {
    return false;
  }

  const beforeRun = parseMatchingDocument(documentId, before);
  if (beforeRun === undefined || beforeRun.delivery !== undefined) {
    return false;
  }

  return true;
}
