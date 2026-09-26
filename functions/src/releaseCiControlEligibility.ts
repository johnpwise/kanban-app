import { z } from "zod";

/**
 * Deliberately not derived from or merged into `executor/src/schemas/releaseIntentDocument.ts`'s
 * full `releaseIntentDocumentSchema`, for the same reason `releasePullRequestCompletionEligibility.
 * ts`'s own standalone schema is: `functions/` and `executor/` are separate npm packages with no
 * workspace linking, and this trigger needs only to detect a `pullRequests.{target}` absent→present
 * transition, never to re-validate the full release-intent shape — so it stays a narrow,
 * presence-only schema. Each target is checked only for being an object when present (a malformed
 * value — e.g. a string or number — fails closed); its internal fields are `executor/`'s concern,
 * never re-validated here.
 */
const releaseCiControlEligibilityDocumentSchema = z.object({
  releaseIntentId: z.string().min(1),
  pullRequests: z
    .object({
      main: z.record(z.string(), z.unknown()).optional(),
      develop: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export type ReleaseCiControlTarget = "main" | "develop";

function parseMatchingDocument(documentId: string, data: unknown) {
  const parsed = releaseCiControlEligibilityDocumentSchema.safeParse(data);
  if (!parsed.success || parsed.data.releaseIntentId !== documentId) {
    return undefined;
  }
  return parsed.data;
}

export interface ReleaseCiControlEligibilityDecisionParams {
  /** Firestore document id from the trigger path (`releaseIntents/{releaseIntentId}`). */
  documentId: string;
  /** Which release PR target's `pullRequests.{target}` transition to check — checked
   * independently, since `recordReleasePullRequestResult` persists `main` and `develop` as
   * separate document updates, never a combined write. */
  target: ReleaseCiControlTarget;
  /** The update trigger event's `before` snapshot data, or `undefined` if it carried none. */
  before: unknown;
  /** The update trigger event's `after` snapshot data, or `undefined` if it carried none. */
  after: unknown;
}

/**
 * True only for a genuine `pullRequests.{target}` (absent → present) transition on a document
 * whose id matches its own `releaseIntentId` on both sides of the update — fail-closed (`false`)
 * for a malformed snapshot, an id mismatch, a missing snapshot, a target that was already present
 * before the update (including a later unrelated or `ci` write — a non-transitioning snapshot), or
 * a target that is still absent after it. The other target's presence or absence never affects this
 * target's own decision — each target is evaluated independently.
 */
export function isReleasePullRequestRecordedEligibleForCiControl({
  documentId,
  target,
  before,
  after,
}: ReleaseCiControlEligibilityDecisionParams): boolean {
  const afterIntent = parseMatchingDocument(documentId, after);
  if (afterIntent === undefined || afterIntent.pullRequests?.[target] === undefined) {
    return false;
  }

  const beforeIntent = parseMatchingDocument(documentId, before);
  if (beforeIntent === undefined || beforeIntent.pullRequests?.[target] !== undefined) {
    return false;
  }

  return true;
}
