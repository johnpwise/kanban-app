import { z } from "zod";

/**
 * Deliberately not derived from or merged into `executor/src/schemas/releaseIntentDocument.ts`'s
 * full `releaseIntentDocumentSchema`, for the same reason `releasePullRequestCompletionEligibility.
 * ts`'s own standalone schema is: `functions/` and `executor/` are separate npm packages with no
 * workspace linking, and this trigger needs only to detect the whole `pullRequests.main` +
 * `pullRequests.develop` pair-completion (not-both → both) transition, never to re-validate the
 * full release-intent shape — so it stays a narrow, presence-only schema. Each target is checked
 * only for being an object when present (a malformed value — e.g. a string or number — fails
 * closed); its internal fields are `executor/`'s concern, never re-validated here.
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

function parseMatchingDocument(documentId: string, data: unknown) {
  const parsed = releaseCiControlEligibilityDocumentSchema.safeParse(data);
  if (!parsed.success || parsed.data.releaseIntentId !== documentId) {
    return undefined;
  }
  return parsed.data;
}

function bothPullRequestsPresent(intent: { pullRequests?: { main?: unknown; develop?: unknown } }): boolean {
  return intent.pullRequests?.main !== undefined && intent.pullRequests?.develop !== undefined;
}

export interface ReleaseCiControlEligibilityDecisionParams {
  /** Firestore document id from the trigger path (`releaseIntents/{releaseIntentId}`). */
  documentId: string;
  /** The update trigger event's `before` snapshot data, or `undefined` if it carried none. */
  before: unknown;
  /** The update trigger event's `after` snapshot data, or `undefined` if it carried none. */
  after: unknown;
}

/**
 * True only for a genuine whole-release-PR-pair-completion transition — both `pullRequests.main`
 * and `pullRequests.develop` present after the update, and not both already present before it — on
 * a document whose id matches its own `releaseIntentId` on both sides of the update. Fail-closed
 * (`false`) for a malformed snapshot, an id mismatch, a missing snapshot, a pair that was already
 * complete before the update (including a later unrelated or `ci` write — a non-transitioning
 * snapshot), or a pair that is still incomplete (only one or neither target present) after it.
 * `releaseCiControllerMain.ts` is a two-target controller that expects both durable PR identities
 * to exist before it starts observing either target's CI, so a single-target presence is never
 * itself eligible.
 */
export function isReleasePullRequestPairCompletionEligibleForCiControl({
  documentId,
  before,
  after,
}: ReleaseCiControlEligibilityDecisionParams): boolean {
  const afterIntent = parseMatchingDocument(documentId, after);
  if (afterIntent === undefined || !bothPullRequestsPresent(afterIntent)) {
    return false;
  }

  const beforeIntent = parseMatchingDocument(documentId, before);
  if (beforeIntent === undefined || bothPullRequestsPresent(beforeIntent)) {
    return false;
  }

  return true;
}
