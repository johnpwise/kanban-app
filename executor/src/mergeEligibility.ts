import { parseExecutionRunDocument } from "./schemas/executionRunDocument";

import type { ObserveDeliveryPullRequest, ObservedPullRequest, ObserveDeliveryPullRequestOutcome } from "./deliveryPullRequestObservation";
import type { ExecutionRunRepository } from "./executionRunRepository";
import type { ExecutorLogger } from "./runExecutor";

type ObservationFailure = Extract<ObserveDeliveryPullRequestOutcome, { ok: false }>;

export interface EvaluateMergeEligibilityParams {
  executionRunId: string;
  /** Reused unmodified — only `loadExecutionRunData` is called; never a write. */
  repository: ExecutionRunRepository;
  /** The existing one-shot primitive (`fetchImpl`/`mintCredential` already bound at composition). */
  observePullRequest: ObserveDeliveryPullRequest;
  logger?: ExecutorLogger;
}

export type MergeEligibilityOutcome =
  | { eligible: true; executionRunId: string; commitSha: string; pullRequestNumber: number }
  | { eligible: false; reason: "execution_run_load_error" }
  | { eligible: false; reason: "execution_run_not_found" }
  | { eligible: false; reason: "execution_run_invalid" }
  | { eligible: false; reason: "status_not_ci_succeeded"; status: string }
  | { eligible: false; reason: "delivery_missing" }
  | { eligible: false; reason: "pull_request_identity_missing" }
  | { eligible: false; reason: "ci_missing" }
  | { eligible: false; reason: "ci_not_succeeded"; state: string }
  | { eligible: false; reason: "ci_delivery_sha_mismatch" }
  | { eligible: false; reason: "pull_request_observation_error" }
  | ({ eligible: false } & Omit<ObservationFailure, "ok">)
  | { eligible: false; reason: "pull_request_already_merged" }
  | { eligible: false; reason: "pull_request_closed" }
  | { eligible: false; reason: "pull_request_draft" }
  | { eligible: false; reason: "pull_request_repository_mismatch" }
  | { eligible: false; reason: "pull_request_head_sha_mismatch" }
  | { eligible: false; reason: "pull_request_head_branch_mismatch" }
  | { eligible: false; reason: "pull_request_base_branch_mismatch" }
  | { eligible: false; reason: "mergeability_pending" }
  | { eligible: false; reason: "not_mergeable" };

/**
 * Evaluates whether a verified ADA delivery whose durable state claims `ci_succeeded` is still
 * eligible for a *future* merge — this boundary establishes permission to merge; it never performs
 * one. Fails closed at the first contradiction, in two ordered phases:
 *
 * 1. **Durable-state validation** — the persisted `executionRuns/{id}` document must exist, validate
 *    against `parseExecutionRunDocument`, carry `status === "ci_succeeded"`, a `delivery` with a
 *    `pullRequest` identity, and a `ci` result whose `state === "succeeded"` and whose `commitSha`
 *    agrees exactly with `delivery.commitSha`. `status === "ci_succeeded"` is never trusted alone —
 *    a status/`ci.state` contradiction (e.g. a hand-edited or partially-written document) fails
 *    closed here, before any GitHub call.
 * 2. **Live GitHub reconciliation** — the exact `delivery.pullRequest.number` (never a PR
 *    rediscovered by branch) is fetched via `observePullRequest`, and the response is checked
 *    against the durable identity: same-repository head/base, open, not merged, not draft, live
 *    head SHA/ref matching `delivery.commitSha`/`delivery.branch`, live base ref matching
 *    `input.baseBranch`, and a positively-established `mergeable === true`. `mergeable === null`
 *    (GitHub still computing it) fails closed as `mergeability_pending`, distinct from a genuine
 *    `mergeable === false` conflict — no polling is performed; a caller wanting a fresher read
 *    calls this again later.
 *
 * Read-only end-to-end: no Firestore write, no GitHub mutation. A later automatic-merge stage must
 * re-run this evaluation immediately before mutating — this result is never persisted as a
 * standing "approved forever" token.
 */
export async function evaluateMergeEligibility(params: EvaluateMergeEligibilityParams): Promise<MergeEligibilityOutcome> {
  const { executionRunId, repository, observePullRequest, logger } = params;

  let data: unknown;
  try {
    data = await repository.loadExecutionRunData(executionRunId);
  } catch {
    logger?.error("Unexpected failure loading the persisted execution run.", { executionRunId });
    return { eligible: false, reason: "execution_run_load_error" };
  }
  if (data === undefined) {
    logger?.error("Cannot evaluate merge eligibility: no such execution run.", { executionRunId });
    return { eligible: false, reason: "execution_run_not_found" };
  }

  let run;
  try {
    run = parseExecutionRunDocument(executionRunId, data);
  } catch {
    logger?.error("Cannot evaluate merge eligibility: the persisted execution run document failed schema validation.", {
      executionRunId,
    });
    return { eligible: false, reason: "execution_run_invalid" };
  }

  if (run.status !== "ci_succeeded") {
    logger?.error("Not eligible: execution run status is not ci_succeeded.", { executionRunId, status: run.status });
    return { eligible: false, reason: "status_not_ci_succeeded", status: run.status };
  }

  if (!run.delivery) {
    logger?.error("Not eligible: no durable delivery is persisted despite a ci_succeeded status.", { executionRunId });
    return { eligible: false, reason: "delivery_missing" };
  }

  if (!run.delivery.pullRequest) {
    logger?.error("Not eligible: the durable delivery has no persisted pull request identity.", { executionRunId });
    return { eligible: false, reason: "pull_request_identity_missing" };
  }

  if (!run.ci) {
    logger?.error("Not eligible: no durable ci result is persisted despite a ci_succeeded status.", { executionRunId });
    return { eligible: false, reason: "ci_missing" };
  }

  if (run.ci.state !== "succeeded") {
    logger?.error("Not eligible: durable ci result contradicts the ci_succeeded status.", { executionRunId, state: run.ci.state });
    return { eligible: false, reason: "ci_not_succeeded", state: run.ci.state };
  }

  if (run.ci.commitSha !== run.delivery.commitSha) {
    logger?.error("Not eligible: durable ci result is anchored to a different commit than the durable delivery.", {
      executionRunId,
    });
    return { eligible: false, reason: "ci_delivery_sha_mismatch" };
  }

  const { repository: expectedRepository, baseBranch: expectedBaseBranch } = run.input;
  const { commitSha: expectedCommitSha, branch: expectedBranch, pullRequest } = run.delivery;
  const safeIdentifiers = {
    executionRunId,
    repository: expectedRepository,
    pullRequestNumber: pullRequest.number,
    expectedCommitSha,
  };

  let observation: ObserveDeliveryPullRequestOutcome;
  try {
    observation = await observePullRequest({ repository: expectedRepository, pullRequestNumber: pullRequest.number });
  } catch {
    logger?.error("Unexpected failure observing the live pull request.", safeIdentifiers);
    return { eligible: false, reason: "pull_request_observation_error" };
  }

  if (!observation.ok) {
    const failureFields = {
      reason: observation.reason,
      ...("credentialReason" in observation ? { credentialReason: observation.credentialReason } : {}),
      ...("httpStatus" in observation ? { httpStatus: observation.httpStatus } : {}),
    };
    logger?.error("Not eligible: live pull request observation failed.", { ...safeIdentifiers, ...failureFields });
    return { eligible: false, ...failureFields };
  }

  const pr: ObservedPullRequest = observation.pullRequest;

  if (pr.headRepositoryFullName !== expectedRepository || pr.baseRepositoryFullName !== expectedRepository) {
    logger?.error("Not eligible: the live pull request's repository identity does not match the expected same-repository delivery.", safeIdentifiers);
    return { eligible: false, reason: "pull_request_repository_mismatch" };
  }

  if (pr.merged) {
    logger?.error("Not eligible: the pull request is already merged.", safeIdentifiers);
    return { eligible: false, reason: "pull_request_already_merged" };
  }

  if (pr.state !== "open") {
    logger?.error("Not eligible: the pull request is no longer open.", safeIdentifiers);
    return { eligible: false, reason: "pull_request_closed" };
  }

  if (pr.draft) {
    logger?.error("Not eligible: the pull request is a draft.", safeIdentifiers);
    return { eligible: false, reason: "pull_request_draft" };
  }

  if (pr.headSha !== expectedCommitSha) {
    logger?.error("Not eligible: the live pull request head has moved away from the verified delivery commit.", safeIdentifiers);
    return { eligible: false, reason: "pull_request_head_sha_mismatch" };
  }

  if (pr.headRef !== expectedBranch) {
    logger?.error("Not eligible: the live pull request head branch no longer matches the durable delivery branch.", safeIdentifiers);
    return { eligible: false, reason: "pull_request_head_branch_mismatch" };
  }

  if (pr.baseRef !== expectedBaseBranch) {
    logger?.error("Not eligible: the pull request has been retargeted to a different base branch.", safeIdentifiers);
    return { eligible: false, reason: "pull_request_base_branch_mismatch" };
  }

  if (pr.mergeable === null) {
    logger?.error("Not eligible: GitHub has not yet established mergeability.", safeIdentifiers);
    return { eligible: false, reason: "mergeability_pending" };
  }

  if (pr.mergeable === false) {
    logger?.error("Not eligible: the pull request is not mergeable.", safeIdentifiers);
    return { eligible: false, reason: "not_mergeable" };
  }

  logger?.info("Merge eligible: durable delivery state agrees with live GitHub pull request state.", safeIdentifiers);
  return { eligible: true, executionRunId, commitSha: expectedCommitSha, pullRequestNumber: pullRequest.number };
}
