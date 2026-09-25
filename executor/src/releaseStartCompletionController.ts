import type { ExecuteEligibleReleaseStartForIntent, ExecuteEligibleReleaseStartOutcome } from "./releaseStartExecution";
import type { ReleaseIntentRepository, ReleaseStartResultIdentity } from "./releaseIntentRepository";
import type { ExecutorLogger } from "./runExecutor";

/** Excludes the two outcomes this controller intercepts to persist — every other typed
 * release-start/eligibility outcome is passed through verbatim, never reinterpreted as success. */
type PassthroughOutcome = Exclude<ExecuteEligibleReleaseStartOutcome, { outcome: "started" } | { outcome: "already_started" }>;

export interface RunReleaseStartCompletionControllerParams {
  releaseIntentId: string;
  /** The guarded release-start/reconciliation boundary, re-run fresh on every call — never a cached
   * prior result. */
  executeEligibleReleaseStart: ExecuteEligibleReleaseStartForIntent;
  /** Reused unmodified — only `recordReleaseStartResult` is called; never a read. */
  repository: ReleaseIntentRepository;
  logger?: ExecutorLogger;
}

export type ReleaseStartCompletionControllerOutcome =
  | {
      outcome: "started";
      releaseIntentId: string;
      repository: string;
      version: string;
      sourceBranch: string;
      sourceRevision: string;
      releaseBranch: string;
      commitSha: string;
    }
  | {
      /** The release-start result was already durably recorded — a safe idempotent convergence,
       * distinct from a freshly completed `started` so a caller never double-reports completion. */
      outcome: "release_start_already_recorded";
      releaseIntentId: string;
      repository: string;
      version: string;
      sourceBranch: string;
      sourceRevision: string;
      releaseBranch: string;
      commitSha: string;
    }
  | { outcome: "release_start_persistence_error"; releaseIntentId: string }
  | { outcome: "release_start_conflict"; releaseIntentId: string }
  | { outcome: "release_start_intent_not_found"; releaseIntentId: string }
  | { outcome: "release_start_intent_invalid"; releaseIntentId: string }
  | { outcome: "release_start_intent_identity_mismatch"; releaseIntentId: string }
  | PassthroughOutcome;

/**
 * The smallest orchestration boundary above `executeEligibleReleaseStart`: ensures a freshly
 * completed or safely reconciled release-start result is durably recorded (via
 * `repository.recordReleaseStartResult`) before the release-start stage is considered complete. This
 * is the boundary that closes the crash window left open by PR #58's guarded release-start execution:
 * if a release branch is successfully pushed and verified but the process dies before persisting, a
 * rerun's fresh `executeEligibleReleaseStart` independently reconciles the same existing release
 * branch against the persisted release intent, recovers the trusted release-start identity, and this
 * controller durably records it — never attempting a second release-start mutation.
 *
 * Only the two outcomes that carry a trusted release-start identity (`started`, the freshly completed
 * mutation; `already_started`, the safely reconciled recovery) trigger a `recordReleaseStartResult`
 * call — `already_started`'s `releaseCommitSha` is used as the persisted `commitSha`, mirroring how
 * `started`'s independently-verified `remoteSha` (never the pre-verification `commitSha`) is used.
 * Every other typed outcome — every ineligible reason and every workspace/branch/commit/push mutation
 * failure — passes through verbatim with no persistence attempt.
 *
 * Persistence failure modes are surfaced distinctly, never folded into a false `started` report: a
 * thrown persistence error is `release_start_persistence_error`; a conflicting already-persisted
 * result is `release_start_conflict`; a missing/invalid/identity-disagreeing release intent is
 * `release_start_intent_not_found` / `release_start_intent_invalid` /
 * `release_start_intent_identity_mismatch`. `recordReleaseStartResult`'s `already_recorded` outcome
 * becomes the distinct `release_start_already_recorded` — a safe idempotent convergence, not a fresh
 * completion.
 */
export async function runReleaseStartCompletionController(
  params: RunReleaseStartCompletionControllerParams,
): Promise<ReleaseStartCompletionControllerOutcome> {
  const { releaseIntentId, executeEligibleReleaseStart, repository, logger } = params;

  const executionOutcome = await executeEligibleReleaseStart(releaseIntentId);

  if (executionOutcome.outcome !== "started" && executionOutcome.outcome !== "already_started") {
    return executionOutcome;
  }

  const { repository: repositoryName, version, sourceBranch, sourceRevision, releaseBranch } = executionOutcome;
  const commitSha = executionOutcome.outcome === "started" ? executionOutcome.remoteSha : executionOutcome.releaseCommitSha;
  const identity: ReleaseStartResultIdentity = { repository: repositoryName, version, sourceBranch, sourceRevision, releaseBranch, commitSha };
  const safeIdentifiers = { releaseIntentId, ...identity };

  let persistOutcome;
  try {
    persistOutcome = await repository.recordReleaseStartResult(releaseIntentId, identity);
  } catch {
    logger?.error("Unexpected failure durably persisting the release-start result.", safeIdentifiers);
    return { outcome: "release_start_persistence_error", releaseIntentId };
  }

  switch (persistOutcome.outcome) {
    case "conflict":
      logger?.error("A conflicting release-start result is already durably persisted for this release intent.", safeIdentifiers);
      return { outcome: "release_start_conflict", releaseIntentId };
    case "release_intent_not_found":
      logger?.error("Cannot persist the release-start result: no such release intent.", safeIdentifiers);
      return { outcome: "release_start_intent_not_found", releaseIntentId };
    case "release_intent_invalid":
      logger?.error("Cannot persist the release-start result: the persisted release intent document failed schema validation.", safeIdentifiers);
      return { outcome: "release_start_intent_invalid", releaseIntentId };
    case "release_intent_identity_mismatch":
      logger?.error("Cannot persist the release-start result: the trusted identity disagrees with the persisted immutable release intent.", safeIdentifiers);
      return { outcome: "release_start_intent_identity_mismatch", releaseIntentId };
    case "already_recorded":
      logger?.info("Release-start result already durably recorded — safe convergence.", safeIdentifiers);
      return { outcome: "release_start_already_recorded", releaseIntentId, ...identity };
    case "created":
      logger?.info("Release-start result durably recorded.", safeIdentifiers);
      return { outcome: "started", releaseIntentId, ...identity };
  }
}
