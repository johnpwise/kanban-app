import type { MergeAdaPullRequest, MergeAdaPullRequestOutcome } from "./adaPullRequestMerge";
import type { MergeEligibilityOutcome } from "./mergeEligibility";
import type { ExecutorLogger } from "./runExecutor";

/** Excludes `pull_request_already_merged` — that reason is special-cased into its own
 * `already_merged` outcome before this branch is ever reached. */
type NotEligibleOutcome = Exclude<Extract<MergeEligibilityOutcome, { eligible: false }>, { reason: "pull_request_already_merged" }>;
type MergeFailure = Extract<MergeAdaPullRequestOutcome, { ok: false }>;

/** A composition-bound closure over `evaluateMergeEligibility` — `repository` (the
 * `ExecutionRunRepository`), `observePullRequest`, and `logger` are bound once by the caller (a
 * composition root), matching how `mintCredential`/`fetchImpl` are bound elsewhere in this
 * codebase; only `executionRunId` is supplied per call. */
export type EvaluateMergeEligibilityForRun = (executionRunId: string) => Promise<MergeEligibilityOutcome>;

export interface ExecuteEligibleDeliveryMergeParams {
  executionRunId: string;
  /** Re-run fresh, immediately before any mutation attempt — never a cached/prior eligibility
   * result. A previous eligibility result must never become a standing merge approval. */
  evaluateMergeEligibility: EvaluateMergeEligibilityForRun;
  /** The one-shot GitHub mutation primitive (`fetchImpl`/`mintCredential` already bound at
   * composition). Called at most once per invocation, only when eligibility is fresh and positive. */
  mergeAdaPullRequest: MergeAdaPullRequest;
  logger?: ExecutorLogger;
}

export type ExecuteEligibleDeliveryMergeOutcome =
  | {
      outcome: "merged";
      executionRunId: string;
      repository: string;
      pullRequestNumber: number;
      /** The verified ADA delivery commit that was merged — distinct from `mergeCommitSha`. */
      deliveryCommitSha: string;
      /** The new commit GitHub created for the merge — distinct from `deliveryCommitSha`. */
      mergeCommitSha: string;
    }
  | {
      outcome: "already_merged";
      executionRunId: string;
      repository: string;
      pullRequestNumber: number;
      /** The verified ADA delivery commit the already-merged PR was safely reconciled against —
       * distinct from `mergeCommitSha`. */
      deliveryCommitSha: string;
      /** GitHub's merge commit identity, recovered from the live already-merged PR — never a
       * second GitHub mutation. */
      mergeCommitSha: string;
    }
  | { outcome: "not_eligible"; executionRunId: string; eligibility: NotEligibleOutcome }
  | ({ outcome: "credential_unavailable"; executionRunId: string; repository: string; pullRequestNumber: number } & Omit<
      Extract<MergeFailure, { reason: "credential_unavailable" }>,
      "ok" | "reason"
    >)
  | { outcome: "pull_request_head_changed"; executionRunId: string; repository: string; pullRequestNumber: number; expectedCommitSha: string }
  | { outcome: "not_mergeable"; executionRunId: string; repository: string; pullRequestNumber: number }
  | { outcome: "merge_permission_denied"; executionRunId: string; repository: string; pullRequestNumber: number }
  | { outcome: "merge_failed"; executionRunId: string; repository: string; pullRequestNumber: number; httpStatus: number }
  | { outcome: "merge_network_error"; executionRunId: string; repository: string; pullRequestNumber: number }
  | { outcome: "invalid_response"; executionRunId: string; repository: string; pullRequestNumber: number };

/**
 * Attempts exactly one guarded GitHub Pull Request merge for the exact ADA delivery
 * `executionRunId` freshly proves eligible — the orchestration boundary above
 * `mergeAdaPullRequest`. Accepts only `executionRunId` plus injected dependencies: the caller can
 * never independently supply `repository` / PR number / commit SHA — those are taken solely from
 * the fresh `evaluateMergeEligibility(...)` result, so a stale or forged identity can never steer
 * the mutation.
 *
 * `evaluateMergeEligibility` is always re-run at the start of this call, never reused from an
 * earlier check. An ineligible result performs no GitHub mutation. A safely reconciled
 * `pull_request_already_merged` result (live identity verified to agree with the durable delivery,
 * carrying a recovered `mergeCommitSha`) is special-cased to a distinct `already_merged` outcome
 * exposing that trusted identity — live GitHub state is authoritative for whether the PR is already
 * merged — rather than a generic `not_eligible` failure, so a repeat invocation after a prior
 * successful merge is never reported as an ambiguous unexpected failure, and a durable persistence
 * step can safely record the recovered merge. Every other ineligible reason — including every
 * already-merged *mismatch* reason, which never becomes a successful recovery — is preserved
 * verbatim under `eligibility`.
 *
 * The small race window between the fresh eligibility check and the merge `PUT` is closed by
 * `mergeAdaPullRequest` itself: it always sends the eligible result's verified commit SHA as
 * GitHub's own head-SHA precondition, so a PR that moved in that window is rejected by GitHub (409)
 * and surfaces here as a distinct `pull_request_head_changed` outcome — never retried within this
 * call.
 */
export async function executeEligibleDeliveryMerge(
  params: ExecuteEligibleDeliveryMergeParams,
): Promise<ExecuteEligibleDeliveryMergeOutcome> {
  const { executionRunId, evaluateMergeEligibility, mergeAdaPullRequest, logger } = params;

  const eligibility = await evaluateMergeEligibility(executionRunId);

  if (!eligibility.eligible) {
    if (eligibility.reason === "pull_request_already_merged") {
      const { repository, pullRequestNumber, deliveryCommitSha, mergeCommitSha } = eligibility;
      logger?.info("Merge already completed: the pull request is already merged.", {
        executionRunId,
        repository,
        pullRequestNumber,
        deliveryCommitSha,
        mergeCommitSha,
      });
      return { outcome: "already_merged", executionRunId, repository, pullRequestNumber, deliveryCommitSha, mergeCommitSha };
    }
    logger?.error("Merge refused: the delivery is not currently eligible.", { executionRunId, reason: eligibility.reason });
    return { outcome: "not_eligible", executionRunId, eligibility };
  }

  const { repository, pullRequestNumber, commitSha } = eligibility;
  const safeIdentifiers = { executionRunId, repository, pullRequestNumber };

  const mergeOutcome = await mergeAdaPullRequest({
    repository,
    pullRequestNumber,
    expectedHeadSha: commitSha,
  });

  if (mergeOutcome.ok) {
    logger?.info("Merge succeeded.", { ...safeIdentifiers, deliveryCommitSha: commitSha, mergeCommitSha: mergeOutcome.mergeCommitSha });
    return {
      outcome: "merged",
      executionRunId,
      repository,
      pullRequestNumber,
      deliveryCommitSha: commitSha,
      mergeCommitSha: mergeOutcome.mergeCommitSha,
    };
  }

  const failureFields = {
    reason: mergeOutcome.reason,
    ...("credentialReason" in mergeOutcome ? { credentialReason: mergeOutcome.credentialReason } : {}),
    ...("httpStatus" in mergeOutcome ? { httpStatus: mergeOutcome.httpStatus } : {}),
  };
  logger?.error("Merge attempt failed.", { ...safeIdentifiers, ...failureFields });

  switch (mergeOutcome.reason) {
    case "credential_unavailable":
      return {
        outcome: "credential_unavailable",
        ...safeIdentifiers,
        credentialReason: mergeOutcome.credentialReason,
        ...("httpStatus" in mergeOutcome ? { httpStatus: mergeOutcome.httpStatus } : {}),
      };
    case "pull_request_head_changed":
      return { outcome: "pull_request_head_changed", ...safeIdentifiers, expectedCommitSha: commitSha };
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
