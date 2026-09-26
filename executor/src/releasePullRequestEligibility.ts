import { deriveReleaseBranchName } from "./releaseBranch";
import { parseReleaseIntentDocument } from "./schemas/releaseIntentDocument";

import type { ExecutorLogger } from "./runExecutor";
import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ObserveGitRefSha } from "./releaseRepositoryObservation";

/** The two trusted intended base branches for a release's Pull Requests — fixed repo/release
 * configuration, never caller-selected and never read from the release intent document. */
const TRUSTED_BASE_BRANCHES = ["main", "develop"] as const;

export interface EvaluateReleasePullRequestEligibilityParams {
  releaseIntentId: string;
  /** The trusted repository identity — deploy-time configuration for this controller stage
   * (`releasePullRequestControllerConfig.ts`), never derived from the persisted intent alone,
   * mirroring `evaluateReleaseEligibility`'s `expectedRepository`. */
  expectedRepository: string;
  /** Reused unmodified — only `loadReleaseIntentData` is called; never a write. */
  repository: ReleaseIntentRepository;
  observeGitRef: ObserveGitRefSha;
  logger?: ExecutorLogger;
}

export type ReleasePullRequestEligibilityOutcome =
  | {
      eligible: true;
      releaseIntentId: string;
      repository: string;
      version: string;
      /** Included only as safe PR-body metadata and downstream durable-identity fields for the
       * execution/persistence layers — never used by this function itself for any eligibility
       * check. */
      sourceBranch: string;
      sourceRevision: string;
      releaseBranch: string;
      /** The trusted, persisted `start.commitSha` — the sole anchor every release PR's head must
       * match; never independently re-derived any other way. */
      releaseCommitSha: string;
      mainBranch: string;
      developBranch: string;
    }
  | { eligible: false; reason: "release_intent_load_error" }
  | { eligible: false; reason: "release_intent_not_found" }
  | { eligible: false; reason: "release_intent_invalid" }
  | { eligible: false; reason: "repository_mismatch" }
  | { eligible: false; reason: "release_start_missing" }
  | { eligible: false; reason: "release_branch_observation_error" }
  | { eligible: false; reason: "release_branch_not_found"; releaseBranch: string }
  | {
      eligible: false;
      reason: "release_branch_head_drift";
      releaseBranch: string;
      expectedCommitSha: string;
      actualCommitSha: string;
    }
  | { eligible: false; reason: "base_branch_observation_error"; base: (typeof TRUSTED_BASE_BRANCHES)[number] }
  | { eligible: false; reason: "base_branch_not_found"; base: (typeof TRUSTED_BASE_BRANCHES)[number] };

/**
 * Evaluates whether a release intent that has already durably completed guarded release-start
 * (`releaseIntents/{id}.start`) is currently eligible for release Pull Request create/reuse — this
 * boundary establishes permission only; it never creates/reuses a PR, never persists, and never
 * repairs the release branch (no rebase/merge/reset/recreate/force-push on any disagreement).
 *
 * Fails closed at the first contradiction: the persisted release intent must exist and validate,
 * its immutable `repository` must agree with the caller-supplied trusted `expectedRepository`, and
 * it must carry a durable `start` result. The live release branch (`release/<version>`, derived
 * deterministically from the trusted `version` — never read from any caller/document field) is then
 * freshly observed and its head must be *exactly* the persisted `start.commitSha`; any drift is
 * reported, never silently accepted or repaired. Finally both trusted intended bases (`main`,
 * `develop` — fixed configuration, never caller-selected) are freshly confirmed to exist.
 *
 * Read-only end-to-end: no Firestore write, no GitHub mutation. A later execution step must re-run
 * this evaluation immediately before mutating — this result is never persisted as a standing
 * "approved forever" token.
 */
export async function evaluateReleasePullRequestEligibility(
  params: EvaluateReleasePullRequestEligibilityParams,
): Promise<ReleasePullRequestEligibilityOutcome> {
  const { releaseIntentId, expectedRepository, repository, observeGitRef, logger } = params;

  let data: unknown;
  try {
    data = await repository.loadReleaseIntentData(releaseIntentId);
  } catch {
    logger?.error("Unexpected failure loading the persisted release intent.", { releaseIntentId });
    return { eligible: false, reason: "release_intent_load_error" };
  }
  if (data === undefined) {
    logger?.error("Cannot evaluate release PR eligibility: no such release intent.", { releaseIntentId });
    return { eligible: false, reason: "release_intent_not_found" };
  }

  let intent;
  try {
    intent = parseReleaseIntentDocument(releaseIntentId, data);
  } catch {
    logger?.error("Cannot evaluate release PR eligibility: the persisted release intent document failed schema validation.", {
      releaseIntentId,
    });
    return { eligible: false, reason: "release_intent_invalid" };
  }

  const safeIdentifiers = { releaseIntentId, repository: intent.repository, version: intent.version };

  if (intent.repository !== expectedRepository) {
    logger?.error("Not eligible: the release intent's repository does not match the trusted expected repository.", safeIdentifiers);
    return { eligible: false, reason: "repository_mismatch" };
  }

  if (!intent.start) {
    logger?.error("Not eligible: the release intent has no durable release-start result yet.", safeIdentifiers);
    return { eligible: false, reason: "release_start_missing" };
  }

  const releaseBranch = deriveReleaseBranchName(intent.version);
  const releaseBranchRef = await observeGitRef({ repository: intent.repository, ref: `heads/${releaseBranch}` });
  if (!releaseBranchRef.ok) {
    logger?.error("Not eligible: observing the release branch failed.", { ...safeIdentifiers, releaseBranch, reason: releaseBranchRef.reason });
    return { eligible: false, reason: "release_branch_observation_error" };
  }
  if (!releaseBranchRef.found) {
    logger?.error("Not eligible: the trusted release branch no longer exists.", { ...safeIdentifiers, releaseBranch });
    return { eligible: false, reason: "release_branch_not_found", releaseBranch };
  }
  if (releaseBranchRef.sha !== intent.start.commitSha) {
    logger?.error("Not eligible: the release branch head has moved away from the trusted persisted start commit.", {
      ...safeIdentifiers,
      releaseBranch,
    });
    return {
      eligible: false,
      reason: "release_branch_head_drift",
      releaseBranch,
      expectedCommitSha: intent.start.commitSha,
      actualCommitSha: releaseBranchRef.sha,
    };
  }

  for (const base of TRUSTED_BASE_BRANCHES) {
    const baseRef = await observeGitRef({ repository: intent.repository, ref: `heads/${base}` });
    if (!baseRef.ok) {
      logger?.error("Not eligible: observing a trusted base branch failed.", { ...safeIdentifiers, base, reason: baseRef.reason });
      return { eligible: false, reason: "base_branch_observation_error", base };
    }
    if (!baseRef.found) {
      logger?.error("Not eligible: a trusted base branch no longer exists.", { ...safeIdentifiers, base });
      return { eligible: false, reason: "base_branch_not_found", base };
    }
  }

  logger?.info("Release PR eligible: durable start result and fresh repository state fully reconcile.", { ...safeIdentifiers, releaseBranch });
  return {
    eligible: true,
    releaseIntentId,
    repository: intent.repository,
    version: intent.version,
    sourceBranch: intent.sourceBranch,
    sourceRevision: intent.sourceRevision,
    releaseBranch,
    releaseCommitSha: intent.start.commitSha,
    mainBranch: "main",
    developBranch: "develop",
  };
}
