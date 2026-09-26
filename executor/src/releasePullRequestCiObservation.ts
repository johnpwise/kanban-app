import { parseReleaseIntentDocument } from "./schemas/releaseIntentDocument";

import type { ObserveGithubPullRequest, ObserveGithubPullRequestOutcome } from "./githubPullRequestObservation";
import type { ObserveReleaseCiStatus, ObserveReleaseCiStatusOutcome } from "./releaseCiObservation";
import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ExecutorLogger } from "./runExecutor";
import type { ReleasePullRequestTarget } from "./schemas/releaseIntentDocument";

type PullRequestObservationFailure = Extract<ObserveGithubPullRequestOutcome, { ok: false }>;
type CiObservationFailure = Extract<ObserveReleaseCiStatusOutcome, { ok: false }>;

export interface ObserveReleaseCiForReleasePullRequestParams {
  releaseIntentId: string;
  target: ReleasePullRequestTarget;
  /** Reused unmodified — only `loadReleaseIntentData` is called; never a write. */
  repository: ReleaseIntentRepository;
  /** The fresh-reconciliation leaf, re-run on every call — never a cached prior observation. */
  observeGithubPullRequest: ObserveGithubPullRequest;
  /** The trusted low-level primitive (`fetchImpl`/`mintCredential` already bound at composition),
   * called only once reconciliation has proven the persisted PR identity still holds. */
  observeReleaseCiStatus: ObserveReleaseCiStatus;
  logger?: ExecutorLogger;
}

export type ObserveReleaseCiForReleasePullRequestOutcome =
  | { outcome: "release_intent_load_error"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_intent_not_found"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_intent_invalid"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | { outcome: "release_pull_request_missing"; releaseIntentId: string; target: ReleasePullRequestTarget }
  | ({
      outcome: "pull_request_observation_failed";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      number: number;
    } & Omit<PullRequestObservationFailure, "ok">)
  | { outcome: "pull_request_repository_mismatch"; releaseIntentId: string; target: ReleasePullRequestTarget; number: number }
  | { outcome: "pull_request_head_repository_mismatch"; releaseIntentId: string; target: ReleasePullRequestTarget; number: number }
  | { outcome: "pull_request_head_branch_mismatch"; releaseIntentId: string; target: ReleasePullRequestTarget; number: number }
  | { outcome: "pull_request_head_sha_mismatch"; releaseIntentId: string; target: ReleasePullRequestTarget; number: number }
  | { outcome: "pull_request_base_branch_mismatch"; releaseIntentId: string; target: ReleasePullRequestTarget; number: number }
  | { outcome: "pull_request_state_invalid"; releaseIntentId: string; target: ReleasePullRequestTarget; number: number }
  | { outcome: "ci_pending"; releaseIntentId: string; target: ReleasePullRequestTarget; number: number }
  | { outcome: "ci_unbound"; releaseIntentId: string; target: ReleasePullRequestTarget; number: number }
  | { outcome: "ci_succeeded"; releaseIntentId: string; target: ReleasePullRequestTarget; number: number; runId: number; htmlUrl: string }
  | {
      outcome: "ci_failed";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      number: number;
      runId: number;
      htmlUrl: string;
      conclusion: string;
    }
  | ({
      outcome: "ci_observation_failed";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      number: number;
    } & Omit<CiObservationFailure, "ok">);

/**
 * The release-specific reconciliation boundary above the low-level `observeReleaseCiStatus`
 * primitive: establishes the trust chain `releaseIntentId + target` → durable
 * `releaseIntents/{id}.pullRequests.{target}` identity → fresh `observeGithubPullRequest`
 * reconciliation → authoritative CI-run identity. The caller supplies only `releaseIntentId` and
 * `target`; it can never independently supply a repository, PR number, SHA, or branch that would
 * bypass the durable release intent.
 *
 * Before CI is ever observed, the persisted PR identity is freshly reconciled against GitHub: the
 * base repository, head repository, head branch, head SHA, base branch, and open state must all
 * agree exactly with the durable `pullRequests.{target}` record (itself anchored to the release
 * intent's trusted `start.commitSha` by `releasePullRequestCompletionController.ts` at write time).
 * Any disagreement — a retargeted base, a drifted head, a fork, an already-closed PR — fails closed
 * with its own distinct outcome and never calls `observeReleaseCiStatus`. Only once reconciliation
 * agrees is CI observed, anchored to the persisted `{number, target, headBranch, headSha}` as the
 * expected identity — never a value re-derived any other way.
 */
export async function observeReleaseCiForReleasePullRequest(
  params: ObserveReleaseCiForReleasePullRequestParams,
): Promise<ObserveReleaseCiForReleasePullRequestOutcome> {
  const { releaseIntentId, target, repository, observeGithubPullRequest, observeReleaseCiStatus, logger } = params;

  let data: unknown;
  try {
    data = await repository.loadReleaseIntentData(releaseIntentId);
  } catch {
    logger?.error("Unexpected failure loading the persisted release intent.", { releaseIntentId, target });
    return { outcome: "release_intent_load_error", releaseIntentId, target };
  }
  if (data === undefined) {
    logger?.error("Cannot observe release CI: no such release intent.", { releaseIntentId, target });
    return { outcome: "release_intent_not_found", releaseIntentId, target };
  }

  let intent;
  try {
    intent = parseReleaseIntentDocument(releaseIntentId, data);
  } catch {
    logger?.error("Cannot observe release CI: the persisted release intent document failed schema validation.", {
      releaseIntentId,
      target,
    });
    return { outcome: "release_intent_invalid", releaseIntentId, target };
  }

  const persistedPullRequest = intent.pullRequests?.[target];
  if (!persistedPullRequest) {
    logger?.error("Cannot observe release CI: no durable release Pull Request result is persisted for this target yet.", {
      releaseIntentId,
      target,
    });
    return { outcome: "release_pull_request_missing", releaseIntentId, target };
  }

  const { number, headBranch, headSha } = persistedPullRequest;
  const safeIdentifiers = { releaseIntentId, target, repository: intent.repository, number };

  const observation = await observeGithubPullRequest({ repository: intent.repository, pullRequestNumber: number });
  if (!observation.ok) {
    logger?.error("Cannot observe release CI: fresh Pull Request reconciliation failed.", { ...safeIdentifiers, reason: observation.reason });
    const { ok: _ok, ...failure } = observation;
    void _ok;
    return { outcome: "pull_request_observation_failed", releaseIntentId, target, number, ...failure };
  }

  const pr = observation.pullRequest;

  if (pr.baseRepositoryFullName !== intent.repository) {
    logger?.error("Not trusting CI: fresh reconciliation found a base repository mismatch.", safeIdentifiers);
    return { outcome: "pull_request_repository_mismatch", releaseIntentId, target, number };
  }
  if (pr.headRepositoryFullName !== intent.repository) {
    logger?.error("Not trusting CI: fresh reconciliation found a head repository mismatch (e.g. a fork).", safeIdentifiers);
    return { outcome: "pull_request_head_repository_mismatch", releaseIntentId, target, number };
  }
  if (pr.headRef !== headBranch) {
    logger?.error("Not trusting CI: fresh reconciliation found a head branch mismatch.", safeIdentifiers);
    return { outcome: "pull_request_head_branch_mismatch", releaseIntentId, target, number };
  }
  if (pr.headSha !== headSha) {
    logger?.error("Not trusting CI: fresh reconciliation found a head SHA mismatch (drift).", safeIdentifiers);
    return { outcome: "pull_request_head_sha_mismatch", releaseIntentId, target, number };
  }
  if (pr.baseRef !== target) {
    logger?.error("Not trusting CI: fresh reconciliation found the pull request has been retargeted.", safeIdentifiers);
    return { outcome: "pull_request_base_branch_mismatch", releaseIntentId, target, number };
  }
  if (pr.state !== "open" || pr.merged) {
    logger?.error("Not trusting CI: fresh reconciliation found the pull request is no longer open.", safeIdentifiers);
    return { outcome: "pull_request_state_invalid", releaseIntentId, target, number };
  }

  const ciObservation = await observeReleaseCiStatus({
    repository: intent.repository,
    expectedIdentity: { prNumber: number, baseBranch: target, headBranch, headSha },
  });

  if (!ciObservation.ok) {
    logger?.error("Release CI observation failed.", { ...safeIdentifiers, reason: ciObservation.reason });
    const { ok: _ok, ...failure } = ciObservation;
    void _ok;
    return { outcome: "ci_observation_failed", releaseIntentId, target, number, ...failure };
  }

  if (ciObservation.state === "pending") {
    return { outcome: "ci_pending", releaseIntentId, target, number };
  }
  if (ciObservation.state === "unbound") {
    logger?.error("Release CI evidence exists for this commit but none is authoritatively bound to this exact Pull Request.", safeIdentifiers);
    return { outcome: "ci_unbound", releaseIntentId, target, number };
  }
  if (ciObservation.state === "succeeded") {
    logger?.info("Release CI succeeded for this exact Pull Request identity.", safeIdentifiers);
    return { outcome: "ci_succeeded", releaseIntentId, target, number, runId: ciObservation.runId, htmlUrl: ciObservation.htmlUrl };
  }
  logger?.error("Release CI failed for this exact Pull Request identity.", { ...safeIdentifiers, conclusion: ciObservation.conclusion });
  return {
    outcome: "ci_failed",
    releaseIntentId,
    target,
    number,
    runId: ciObservation.runId,
    htmlUrl: ciObservation.htmlUrl,
    conclusion: ciObservation.conclusion,
  };
}
