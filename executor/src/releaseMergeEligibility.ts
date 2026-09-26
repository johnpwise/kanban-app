import { parseReleaseIntentDocument } from "./schemas/releaseIntentDocument";

import type { ObserveGithubPullRequest, ObserveGithubPullRequestOutcome } from "./githubPullRequestObservation";
import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ExecutorLogger } from "./runExecutor";
import type { ReleasePullRequestTarget } from "./schemas/releaseIntentDocument";

type ObservationFailure = Extract<ObserveGithubPullRequestOutcome, { ok: false }>;

/** Both trusted release Pull Request targets, in the durable-evidence validation order applied to
 * every phase below — deliberately independent of which `target` the caller asked to evaluate: the
 * release pair is the authority unit, so a request to evaluate `main` still fails closed if
 * `develop`'s evidence is incomplete or contradictory, and vice versa. */
const RELEASE_PULL_REQUEST_TARGETS = ["main", "develop"] as const;

export interface EvaluateReleaseMergeEligibilityParams {
  releaseIntentId: string;
  target: ReleasePullRequestTarget;
  /** Reused unmodified — only `loadReleaseIntentData` is called; never a write. */
  repository: ReleaseIntentRepository;
  /** The fresh-reconciliation leaf, re-run on every call — never a cached prior observation. Called
   * once for `target`, plus a second time for `main` when `target` is `develop` (the merge-ordering
   * prerequisite below). */
  observeGithubPullRequest: ObserveGithubPullRequest;
  logger?: ExecutorLogger;
}

export type ReleaseMergeEligibilityOutcome =
  | { eligible: true; releaseIntentId: string; target: ReleasePullRequestTarget; repository: string; pullRequestNumber: number; headSha: string }
  | { eligible: false; reason: "release_intent_load_error" }
  | { eligible: false; reason: "release_intent_not_found" }
  | { eligible: false; reason: "release_intent_invalid" }
  | { eligible: false; reason: "release_start_missing" }
  | { eligible: false; reason: "pull_request_missing"; evidenceTarget: ReleasePullRequestTarget }
  | { eligible: false; reason: "ci_missing"; evidenceTarget: ReleasePullRequestTarget }
  | { eligible: false; reason: "ci_not_succeeded"; evidenceTarget: ReleasePullRequestTarget }
  | { eligible: false; reason: "pull_request_base_branch_invalid"; evidenceTarget: ReleasePullRequestTarget }
  | { eligible: false; reason: "ci_pull_request_number_mismatch"; evidenceTarget: ReleasePullRequestTarget }
  | { eligible: false; reason: "ci_pull_request_base_branch_mismatch"; evidenceTarget: ReleasePullRequestTarget }
  | { eligible: false; reason: "ci_pull_request_head_branch_mismatch"; evidenceTarget: ReleasePullRequestTarget }
  | { eligible: false; reason: "ci_pull_request_head_sha_mismatch"; evidenceTarget: ReleasePullRequestTarget }
  | { eligible: false; reason: "pull_request_start_head_branch_mismatch"; evidenceTarget: ReleasePullRequestTarget }
  | { eligible: false; reason: "pull_request_start_head_sha_mismatch"; evidenceTarget: ReleasePullRequestTarget }
  | { eligible: false; reason: "main_prerequisite_observation_error" }
  | { eligible: false; reason: "main_pull_request_merge_unverified" }
  | { eligible: false; reason: "pull_request_observation_error"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | ({ eligible: false; target: ReleasePullRequestTarget; pullRequestNumber: number } & Omit<ObservationFailure, "ok">)
  | {
      eligible: false;
      reason: "pull_request_already_merged";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      repository: string;
      pullRequestNumber: number;
      /** The verified durable release PR head this recovery is anchored to — distinct from
       * `mergeCommitSha`. */
      headSha: string;
      /** GitHub's merge commit identity, recovered from the live already-merged PR. */
      mergeCommitSha: string;
    }
  | { eligible: false; reason: "pull_request_already_merged_head_sha_mismatch"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "pull_request_already_merged_head_branch_mismatch"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "pull_request_already_merged_base_branch_mismatch"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "pull_request_already_merged_commit_sha_missing"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "pull_request_repository_mismatch"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "pull_request_head_repository_mismatch"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "pull_request_closed"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "pull_request_draft"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "pull_request_head_sha_mismatch"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "pull_request_head_branch_mismatch"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "pull_request_base_branch_mismatch"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "mergeability_pending"; target: ReleasePullRequestTarget; pullRequestNumber: number }
  | { eligible: false; reason: "not_mergeable"; target: ReleasePullRequestTarget; pullRequestNumber: number };

/**
 * Evaluates whether an exact release Pull Request (`releaseIntentId` + `target`) is presently
 * eligible for a *future* guarded merge — this boundary establishes permission; it never merges,
 * deploys, or triggers finalisation. The caller supplies only `releaseIntentId` and `target`; every
 * other identity (repository, PR number, release branch/commit, CI run) comes solely from trusted
 * durable state plus fresh GitHub reconciliation, never from the caller.
 *
 * Four ordered phases, each failing closed at the first contradiction and never trusting schema
 * shape alone where a semantically contradictory but schema-valid document could exist:
 *
 * 1. **Durable release intent** — `releaseIntents/{releaseIntentId}` must exist, validate against
 *    `parseReleaseIntentDocument`, and carry a durable `start` result (the anchor every release PR's
 *    head must match).
 * 2. **Complete release PR pair** — both `pullRequests.main` and `pullRequests.develop` must be
 *    present. One target can never become independently mergeable before ADA has established the
 *    complete intended release pair.
 * 3. **Complete trusted CI pair** — both `ci.main` and `ci.develop` must be present and
 *    `state === "succeeded"`. The release pair is the authority unit: `main` succeeded with
 *    `develop` missing or failed is never eligible, and vice versa.
 * 4. **Cross-checked identity** — for both targets, `ci.{target}` must agree exactly with
 *    `pullRequests.{target}` (`number`/`baseBranch`/`headBranch`/`headSha`), `pullRequests.{target}`
 *    must agree with the trusted release-start anchor (`headBranch === start.releaseBranch`,
 *    `headSha === start.commitSha`), and `pullRequests.{target}.baseBranch` must equal the literal
 *    target string.
 *
 * Only once all durable evidence agrees does this function observe the exact target PR live via
 * `observeGithubPullRequest` (never a PR rediscovered by branch), reconciling repository identity,
 * head/base ref and SHA, state, draft, and mergeability against the durable identity above.
 *
 * An already-merged PR (`merged === true`) is never treated as proof of a successful automated merge
 * on its own: full agreement (repository, head SHA, head branch, base branch) plus a non-null
 * `mergeCommitSha` yields a recoverable `pull_request_already_merged` outcome carrying that trusted
 * identity for a future completion/persistence layer to recover without a second GitHub mutation.
 * Any disagreement fails closed with its own distinct reason, never folded into that recovery
 * outcome. For a still-open PR, `mergeable === null` fails closed as the transient
 * `mergeability_pending`, distinct from a genuine `mergeable === false` `not_mergeable` — no polling
 * is performed here.
 *
 * **Merge ordering (`main` before `develop`)**: no persisted merge-evidence schema is introduced for
 * this — durable release-intent state has no field recording whether a PR has actually been merged,
 * so ordering can only be enforced by a fresh, read-only GitHub observation of the `main` PR's live
 * state, not by trusting anything durable. When `target === "develop"`, this function first freshly
 * observes the durable `pullRequests.main` identity on GitHub and requires it to be safely
 * reconciled as merged (exact identity agreement plus a non-null merge commit SHA) before evaluating
 * `develop` at all; `develop` is never independently eligible while `main` is not yet verified
 * merged. This keeps the ordering guarantee entirely inside this read-only boundary without
 * inventing persistence this slice does not otherwise need — see the workflow decision log.
 *
 * Read-only end-to-end: no Firestore write, no GitHub mutation. A later merge-execution stage must
 * re-run this evaluation immediately before mutating — this result is never persisted as a standing
 * "approved forever" token.
 */
export async function evaluateReleaseMergeEligibility(
  params: EvaluateReleaseMergeEligibilityParams,
): Promise<ReleaseMergeEligibilityOutcome> {
  const { releaseIntentId, target, repository, observeGithubPullRequest, logger } = params;
  const safeIdentifiers = { releaseIntentId, target };

  let data: unknown;
  try {
    data = await repository.loadReleaseIntentData(releaseIntentId);
  } catch {
    logger?.error("Unexpected failure loading the persisted release intent.", safeIdentifiers);
    return { eligible: false, reason: "release_intent_load_error" };
  }
  if (data === undefined) {
    logger?.error("Cannot evaluate release merge eligibility: no such release intent.", safeIdentifiers);
    return { eligible: false, reason: "release_intent_not_found" };
  }

  let intent;
  try {
    intent = parseReleaseIntentDocument(releaseIntentId, data);
  } catch {
    logger?.error(
      "Cannot evaluate release merge eligibility: the persisted release intent document failed schema validation.",
      safeIdentifiers,
    );
    return { eligible: false, reason: "release_intent_invalid" };
  }

  if (!intent.start) {
    logger?.error("Not eligible: the release intent has no durable release-start result yet.", safeIdentifiers);
    return { eligible: false, reason: "release_start_missing" };
  }
  const { start, repository: trustedRepository } = intent;

  // Phase 2 — complete release PR pair.
  for (const evidenceTarget of RELEASE_PULL_REQUEST_TARGETS) {
    if (!intent.pullRequests?.[evidenceTarget]) {
      logger?.error("Not eligible: the release PR pair is incomplete.", { ...safeIdentifiers, evidenceTarget });
      return { eligible: false, reason: "pull_request_missing", evidenceTarget };
    }
  }

  // Phase 3 — complete trusted CI pair.
  for (const evidenceTarget of RELEASE_PULL_REQUEST_TARGETS) {
    const ci = intent.ci?.[evidenceTarget];
    if (!ci) {
      logger?.error("Not eligible: the trusted release CI pair is incomplete.", { ...safeIdentifiers, evidenceTarget });
      return { eligible: false, reason: "ci_missing", evidenceTarget };
    }
    if (ci.state !== "succeeded") {
      logger?.error("Not eligible: durable release CI did not succeed for this target.", { ...safeIdentifiers, evidenceTarget });
      return { eligible: false, reason: "ci_not_succeeded", evidenceTarget };
    }
  }

  // Phase 4 — cross-checked durable identity (CI vs PR, PR vs release-start anchor, base branch).
  for (const evidenceTarget of RELEASE_PULL_REQUEST_TARGETS) {
    // Non-null: guaranteed present by phases 2 and 3 above.
    const pullRequest = intent.pullRequests![evidenceTarget]!;
    const ci = intent.ci![evidenceTarget]!;

    if (pullRequest.baseBranch !== evidenceTarget) {
      logger?.error("Not eligible: the durable release PR's base branch is not the trusted target.", { ...safeIdentifiers, evidenceTarget });
      return { eligible: false, reason: "pull_request_base_branch_invalid", evidenceTarget };
    }
    if (ci.number !== pullRequest.number) {
      logger?.error("Not eligible: durable CI evidence does not agree with the durable PR identity (number).", { ...safeIdentifiers, evidenceTarget });
      return { eligible: false, reason: "ci_pull_request_number_mismatch", evidenceTarget };
    }
    if (ci.baseBranch !== pullRequest.baseBranch) {
      logger?.error("Not eligible: durable CI evidence does not agree with the durable PR identity (base branch).", { ...safeIdentifiers, evidenceTarget });
      return { eligible: false, reason: "ci_pull_request_base_branch_mismatch", evidenceTarget };
    }
    if (ci.headBranch !== pullRequest.headBranch) {
      logger?.error("Not eligible: durable CI evidence does not agree with the durable PR identity (head branch).", { ...safeIdentifiers, evidenceTarget });
      return { eligible: false, reason: "ci_pull_request_head_branch_mismatch", evidenceTarget };
    }
    if (ci.headSha !== pullRequest.headSha) {
      logger?.error("Not eligible: durable CI evidence does not agree with the durable PR identity (head SHA).", { ...safeIdentifiers, evidenceTarget });
      return { eligible: false, reason: "ci_pull_request_head_sha_mismatch", evidenceTarget };
    }
    if (pullRequest.headBranch !== start.releaseBranch) {
      logger?.error("Not eligible: the durable PR head branch does not agree with the trusted release-start anchor.", {
        ...safeIdentifiers,
        evidenceTarget,
      });
      return { eligible: false, reason: "pull_request_start_head_branch_mismatch", evidenceTarget };
    }
    if (pullRequest.headSha !== start.commitSha) {
      logger?.error("Not eligible: the durable PR head SHA does not agree with the trusted release-start anchor.", {
        ...safeIdentifiers,
        evidenceTarget,
      });
      return { eligible: false, reason: "pull_request_start_head_sha_mismatch", evidenceTarget };
    }
  }

  // Phase 5 — merge ordering: `develop` is never independently eligible until `main` is freshly
  // observed, live, as safely merged. No durable merge-evidence schema exists to check this from —
  // see the docstring above.
  if (target === "develop") {
    const mainPullRequest = intent.pullRequests!.main!;
    let mainObservation: ObserveGithubPullRequestOutcome;
    try {
      mainObservation = await observeGithubPullRequest({ repository: trustedRepository, pullRequestNumber: mainPullRequest.number });
    } catch {
      logger?.error("Merge ordering could not be verified: unexpected failure observing the live main pull request.", safeIdentifiers);
      return { eligible: false, reason: "main_prerequisite_observation_error" };
    }
    // A returned (non-thrown) observation failure here — e.g. `credential_unavailable` — is
    // deliberately folded into the same `main_pull_request_merge_unverified` reason as any other
    // unverified state, rather than passed through with its own granular reason: this prerequisite
    // exists only to gate `develop`, and a caller wanting the full diagnostic taxonomy for `main`
    // itself can call this function again with `target: "main"` directly.
    if (
      !mainObservation.ok ||
      mainObservation.pullRequest.baseRepositoryFullName !== trustedRepository ||
      mainObservation.pullRequest.headRepositoryFullName !== trustedRepository ||
      mainObservation.pullRequest.headSha !== mainPullRequest.headSha ||
      mainObservation.pullRequest.headRef !== mainPullRequest.headBranch ||
      mainObservation.pullRequest.baseRef !== "main" ||
      !mainObservation.pullRequest.merged ||
      mainObservation.pullRequest.mergeCommitSha === null
    ) {
      logger?.error("Not eligible: develop cannot be merged before main is verified, live, as safely merged.", safeIdentifiers);
      return { eligible: false, reason: "main_pull_request_merge_unverified" };
    }
  }

  // Phase 6 — fresh exact GitHub reconciliation of the requested target.
  const pullRequest = intent.pullRequests![target]!;
  const safeTargetIdentifiers = { releaseIntentId, target, pullRequestNumber: pullRequest.number };

  let observation: ObserveGithubPullRequestOutcome;
  try {
    observation = await observeGithubPullRequest({ repository: trustedRepository, pullRequestNumber: pullRequest.number });
  } catch {
    logger?.error("Unexpected failure observing the live pull request.", safeTargetIdentifiers);
    return { eligible: false, reason: "pull_request_observation_error", target, pullRequestNumber: pullRequest.number };
  }

  if (!observation.ok) {
    logger?.error("Not eligible: live pull request observation failed.", { ...safeTargetIdentifiers, reason: observation.reason });
    const { ok: _ok, ...failure } = observation;
    void _ok;
    return { eligible: false, target, pullRequestNumber: pullRequest.number, ...failure };
  }

  const pr = observation.pullRequest;

  if (pr.baseRepositoryFullName !== trustedRepository) {
    logger?.error("Not eligible: the live pull request's base repository does not match the trusted release repository.", safeTargetIdentifiers);
    return { eligible: false, reason: "pull_request_repository_mismatch", target, pullRequestNumber: pullRequest.number };
  }
  if (pr.headRepositoryFullName !== trustedRepository) {
    logger?.error("Not eligible: the live pull request's head repository does not match the trusted release repository.", safeTargetIdentifiers);
    return { eligible: false, reason: "pull_request_head_repository_mismatch", target, pullRequestNumber: pullRequest.number };
  }

  if (pr.merged) {
    if (pr.headSha !== pullRequest.headSha) {
      logger?.error("Already-merged reconciliation failed: the live PR head does not match the durable release PR identity.", safeTargetIdentifiers);
      return { eligible: false, reason: "pull_request_already_merged_head_sha_mismatch", target, pullRequestNumber: pullRequest.number };
    }
    if (pr.headRef !== pullRequest.headBranch) {
      logger?.error("Already-merged reconciliation failed: the live PR head branch does not match the durable release PR identity.", safeTargetIdentifiers);
      return { eligible: false, reason: "pull_request_already_merged_head_branch_mismatch", target, pullRequestNumber: pullRequest.number };
    }
    if (pr.baseRef !== target) {
      logger?.error("Already-merged reconciliation failed: the live PR base branch does not match the requested target.", safeTargetIdentifiers);
      return { eligible: false, reason: "pull_request_already_merged_base_branch_mismatch", target, pullRequestNumber: pullRequest.number };
    }
    if (pr.mergeCommitSha === null) {
      logger?.error("Already-merged reconciliation failed: GitHub reports the PR merged but supplied no merge commit SHA.", safeTargetIdentifiers);
      return { eligible: false, reason: "pull_request_already_merged_commit_sha_missing", target, pullRequestNumber: pullRequest.number };
    }
    logger?.info("Already merged: live pull request identity agrees with the durable release PR — safe to reconcile.", safeTargetIdentifiers);
    return {
      eligible: false,
      reason: "pull_request_already_merged",
      releaseIntentId,
      target,
      repository: trustedRepository,
      pullRequestNumber: pullRequest.number,
      headSha: pullRequest.headSha,
      mergeCommitSha: pr.mergeCommitSha,
    };
  }

  if (pr.state !== "open") {
    logger?.error("Not eligible: the pull request is no longer open.", safeTargetIdentifiers);
    return { eligible: false, reason: "pull_request_closed", target, pullRequestNumber: pullRequest.number };
  }
  if (pr.draft) {
    logger?.error("Not eligible: the pull request is a draft.", safeTargetIdentifiers);
    return { eligible: false, reason: "pull_request_draft", target, pullRequestNumber: pullRequest.number };
  }
  if (pr.headSha !== pullRequest.headSha) {
    logger?.error("Not eligible: the live pull request head has moved away from the durable release PR identity.", safeTargetIdentifiers);
    return { eligible: false, reason: "pull_request_head_sha_mismatch", target, pullRequestNumber: pullRequest.number };
  }
  if (pr.headRef !== pullRequest.headBranch) {
    logger?.error("Not eligible: the live pull request head branch no longer matches the durable release PR identity.", safeTargetIdentifiers);
    return { eligible: false, reason: "pull_request_head_branch_mismatch", target, pullRequestNumber: pullRequest.number };
  }
  if (pr.baseRef !== target) {
    logger?.error("Not eligible: the pull request has been retargeted to a different base branch.", safeTargetIdentifiers);
    return { eligible: false, reason: "pull_request_base_branch_mismatch", target, pullRequestNumber: pullRequest.number };
  }
  if (pr.mergeable === null) {
    logger?.error("Not eligible: GitHub has not yet established mergeability.", safeTargetIdentifiers);
    return { eligible: false, reason: "mergeability_pending", target, pullRequestNumber: pullRequest.number };
  }
  if (pr.mergeable === false) {
    logger?.error("Not eligible: the pull request is not mergeable.", safeTargetIdentifiers);
    return { eligible: false, reason: "not_mergeable", target, pullRequestNumber: pullRequest.number };
  }

  logger?.info("Release merge eligible: durable release evidence and fresh GitHub reconciliation fully agree.", safeTargetIdentifiers);
  return {
    eligible: true,
    releaseIntentId,
    target,
    repository: trustedRepository,
    pullRequestNumber: pullRequest.number,
    headSha: pullRequest.headSha,
  };
}
