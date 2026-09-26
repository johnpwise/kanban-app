import { z } from "zod";

/**
 * Deliberately not derived from or merged into `executor/src/schemas/releaseIntentDocument.ts`'s
 * full `releaseIntentDocumentSchema`, for the same reason `mergeCompletionEligibility.ts`'s own
 * standalone schema is: `functions/` and `executor/` are separate npm packages with no workspace
 * linking, and this trigger needs only to detect a `start` absent→present transition, never to
 * re-validate the full release-intent shape — so it stays a narrow, presence-only schema. `start`
 * is checked only for being an object when present (a malformed `start` — e.g. a string or number
 * — fails closed); its internal fields are `executor/`'s concern, never re-validated here.
 */
const releasePullRequestCompletionEligibilityDocumentSchema = z.object({
  releaseIntentId: z.string().min(1),
  start: z.record(z.string(), z.unknown()).optional(),
});

function parseMatchingDocument(documentId: string, data: unknown) {
  const parsed = releasePullRequestCompletionEligibilityDocumentSchema.safeParse(data);
  if (!parsed.success || parsed.data.releaseIntentId !== documentId) {
    return undefined;
  }
  return parsed.data;
}

export interface ReleasePullRequestCompletionEligibilityDecisionParams {
  /** Firestore document id from the trigger path (`releaseIntents/{releaseIntentId}`). */
  documentId: string;
  /** The update trigger event's `before` snapshot data, or `undefined` if it carried none. */
  before: unknown;
  /** The update trigger event's `after` snapshot data, or `undefined` if it carried none. */
  after: unknown;
}

/**
 * True only for a genuine `start` (absent → present) transition on a document whose id matches its
 * own `releaseIntentId` on both sides of the update — fail-closed (`false`) for a malformed
 * snapshot, an id mismatch, a missing snapshot, a `start` that was already present before the
 * update (including a later unrelated or `pullRequests` write — a non-transitioning snapshot), or
 * a `start` that is still absent after it.
 */
export function isReleaseStartCompletionEligibleForPullRequestControl({
  documentId,
  before,
  after,
}: ReleasePullRequestCompletionEligibilityDecisionParams): boolean {
  const afterIntent = parseMatchingDocument(documentId, after);
  if (afterIntent === undefined || afterIntent.start === undefined) {
    return false;
  }

  const beforeIntent = parseMatchingDocument(documentId, before);
  if (beforeIntent === undefined || beforeIntent.start !== undefined) {
    return false;
  }

  return true;
}
