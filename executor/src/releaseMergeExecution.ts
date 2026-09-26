import type { MergeAdaPullRequest, MergeAdaPullRequestOutcome } from "./adaPullRequestMerge";
import type { ReleaseMergeEligibilityOutcome } from "./releaseMergeEligibility";
import type { ExecutorLogger } from "./runExecutor";
import type { ReleasePullRequestTarget } from "./schemas/releaseIntentDocument";

/** Excludes `pull_request_already_merged` — that reason is special-cased into its own
 * `already_merged` outcome before this branch is ever reached. */
type NotEligibleOutcome = Exclude<Extract<ReleaseMergeEligibilityOutcome, { eligible: false }>, { reason: "pull_request_already_merged" }>;
type MergeFailure = Extract<MergeAdaPullRequestOutcome, { ok: false }>;

/** A composition-bound closure over `evaluateReleaseMergeEligibility` — `repository`,
 * `observeGithubPullRequest`, and `logger` are bound once by the caller (a composition root),
 * matching how `EvaluateMergeEligibilityForRun` and `EvaluateReleasePullRequestEligibilityForIntent`
 * are bound elsewhere in this codebase; only `releaseIntentId` and `target` are supplied per call —
 * the caller can never independently supply repository, PR number, or expected head SHA. */
export type EvaluateReleaseMergeEligibilityForIntent = (
  releaseIntentId: string,
  target: ReleasePullRequestTarget,
) => Promise<ReleaseMergeEligibilityOutcome>;

export interface ExecuteEligibleReleaseMergeParams {
  releaseIntentId: string;
  target: ReleasePullRequestTarget;
  /** Re-run fresh, immediately before any mutation attempt — never a cached/prior eligibility
   * result. A previous eligibility result must never become a standing merge approval. */
  evaluateReleaseMergeEligibility: EvaluateReleaseMergeEligibilityForIntent;
  /** The one-shot GitHub mutation primitive (`fetchImpl`/`mintCredential` already bound at
   * composition). Called at most once per invocation, only when eligibility is fresh and positive. */
  mergeAdaPullRequest: MergeAdaPullRequest;
  logger?: ExecutorLogger;
}

export type ExecuteEligibleReleaseMergeOutcome =
  | {
      outcome: "merged";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      repository: string;
      pullRequestNumber: number;
      /** The verified release PR head that was merged — distinct from `mergeCommitSha`. */
      headSha: string;
      /** The new commit GitHub created for the merge — distinct from `headSha`. */
      mergeCommitSha: string;
    }
  | {
      outcome: "already_merged";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      repository: string;
      pullRequestNumber: number;
      /** The verified release PR head the already-merged PR was safely reconciled against —
       * distinct from `mergeCommitSha`. */
      headSha: string;
      /** GitHub's merge commit identity, recovered from the live already-merged PR — never a
       * second GitHub mutation. */
      mergeCommitSha: string;
    }
  | { outcome: "not_eligible"; releaseIntentId: string; target: ReleasePullRequestTarget; eligibility: NotEligibleOutcome }
  | ({
      outcome: "credential_unavailable";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      repository: string;
      pullRequestNumber: number;
    } & Omit<Extract<MergeFailure, { reason: "credential_unavailable" }>, "ok" | "reason">)
  | {
      outcome: "pull_request_head_changed";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      repository: string;
      pullRequestNumber: number;
      expectedHeadSha: string;
    }
  | { outcome: "not_mergeable"; releaseIntentId: string; target: ReleasePullRequestTarget; repository: string; pullRequestNumber: number }
  | { outcome: "merge_permission_denied"; releaseIntentId: string; target: ReleasePullRequestTarget; repository: string; pullRequestNumber: number }
  | {
      outcome: "merge_failed";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      repository: string;
      pullRequestNumber: number;
      httpStatus: number;
    }
  | { outcome: "merge_network_error"; releaseIntentId: string; target: ReleasePullRequestTarget; repository: string; pullRequestNumber: number }
  | { outcome: "invalid_response"; releaseIntentId: string; target: ReleasePullRequestTarget; repository: string; pullRequestNumber: number };

/**
 * Attempts exactly one guarded GitHub Pull Request merge for the exact release
 * `releaseIntentId` + `target` freshly proves eligible — the orchestration boundary above
 * `mergeAdaPullRequest`, mirroring `mergeExecution.ts`'s ordinary-delivery pattern. Accepts only
 * `releaseIntentId` and `target` plus injected dependencies: the caller can never independently
 * supply repository / PR number / expected head SHA — those are taken solely from the fresh
 * `evaluateReleaseMergeEligibility(releaseIntentId, target)` result, so a stale or forged identity
 * can never steer the mutation. Eligibility is never a standing approval.
 *
 * `evaluateReleaseMergeEligibility` is always re-run at the start of this call, never reused from an
 * earlier check. An ineligible result performs no GitHub mutation. A safely reconciled
 * `pull_request_already_merged` result (live identity verified to agree with the durable release PR,
 * carrying a recovered `mergeCommitSha`) is special-cased to a distinct `already_merged` outcome
 * exposing that trusted identity — supporting crash recovery where GitHub merge succeeded previously
 * but durable merge-result persistence did not occur — rather than a generic `not_eligible` failure.
 * Every other ineligible reason — including every already-merged *mismatch* reason, which never
 * becomes a successful recovery — is preserved verbatim under `eligibility`.
 *
 * Main-before-develop ordering is never duplicated here: `evaluateReleaseMergeEligibility` remains
 * the sole authority, so `develop` only reaches the eligible branch once eligibility itself has
 * already proved `main` safely merged.
 *
 * The small race window between the fresh eligibility check and the merge `PUT` is closed by
 * `mergeAdaPullRequest` itself: it always sends the eligible result's verified `headSha` as GitHub's
 * own head-SHA precondition, so a PR that moved in that window is rejected by GitHub (409) and
 * surfaces here as a distinct `pull_request_head_changed` outcome — never retried within this call.
 */
export async function executeEligibleReleaseMerge(
  params: ExecuteEligibleReleaseMergeParams,
): Promise<ExecuteEligibleReleaseMergeOutcome> {
  const { releaseIntentId, target, evaluateReleaseMergeEligibility, mergeAdaPullRequest, logger } = params;

  const eligibility = await evaluateReleaseMergeEligibility(releaseIntentId, target);

  if (!eligibility.eligible) {
    if (eligibility.reason === "pull_request_already_merged") {
      const { repository, pullRequestNumber, headSha, mergeCommitSha } = eligibility;
      logger?.info("Release merge already completed: the pull request is already merged.", {
        releaseIntentId,
        target,
        repository,
        pullRequestNumber,
        headSha,
        mergeCommitSha,
      });
      return { outcome: "already_merged", releaseIntentId, target, repository, pullRequestNumber, headSha, mergeCommitSha };
    }
    logger?.error("Release merge refused: not currently eligible.", { releaseIntentId, target, reason: eligibility.reason });
    return { outcome: "not_eligible", releaseIntentId, target, eligibility };
  }

  const { repository, pullRequestNumber, headSha } = eligibility;
  const safeIdentifiers = { releaseIntentId, target, repository, pullRequestNumber };

  const mergeOutcome = await mergeAdaPullRequest({ repository, pullRequestNumber, expectedHeadSha: headSha });

  if (mergeOutcome.ok) {
    logger?.info("Release merge succeeded.", { ...safeIdentifiers, headSha, mergeCommitSha: mergeOutcome.mergeCommitSha });
    return { outcome: "merged", releaseIntentId, target, repository, pullRequestNumber, headSha, mergeCommitSha: mergeOutcome.mergeCommitSha };
  }

  const failureFields = {
    reason: mergeOutcome.reason,
    ...("credentialReason" in mergeOutcome ? { credentialReason: mergeOutcome.credentialReason } : {}),
    ...("httpStatus" in mergeOutcome ? { httpStatus: mergeOutcome.httpStatus } : {}),
  };
  logger?.error("Release merge attempt failed.", { ...safeIdentifiers, ...failureFields });

  switch (mergeOutcome.reason) {
    case "credential_unavailable":
      return {
        outcome: "credential_unavailable",
        ...safeIdentifiers,
        credentialReason: mergeOutcome.credentialReason,
        ...("httpStatus" in mergeOutcome ? { httpStatus: mergeOutcome.httpStatus } : {}),
      };
    case "pull_request_head_changed":
      return { outcome: "pull_request_head_changed", ...safeIdentifiers, expectedHeadSha: headSha };
    case "not_mergeable":
      return { outcome: "not_mergeable", ...safeIdentifiers };
    case "merge_permission_denied":
      return { outcome: "merge_permission_denied", ...safeIdentifiers };
    case "merge_failed":
      return { outcome: "merge_failed", ...safeIdentifiers, httpStatus: mergeOutcome.httpStatus };
    case "merge_network_error":
      return { outcome: "merge_network_error", ...safeIdentifiers };
    case "invalid_response":
      return { outcome: "invalid_response", ...safeIdentifiers };
  }
}
