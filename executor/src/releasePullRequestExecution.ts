import type { CreateOrReuseGithubPullRequest, CreateOrReuseGithubPullRequestOutcome } from "./githubPullRequest";
import type { ObserveGithubPullRequest, ObserveGithubPullRequestOutcome } from "./githubPullRequestObservation";
import type { ReleasePullRequestEligibilityOutcome } from "./releasePullRequestEligibility";
import type { ExecutorLogger } from "./runExecutor";
import type { ReleasePullRequestTarget } from "./schemas/releaseIntentDocument";

type NotEligibleOutcome = Extract<ReleasePullRequestEligibilityOutcome, { eligible: false }>;
type CreateFailure = Extract<CreateOrReuseGithubPullRequestOutcome, { ok: false }>;
type ObservationFailure = Extract<ObserveGithubPullRequestOutcome, { ok: false }>;

/** A composition-bound closure over `evaluateReleasePullRequestEligibility` — every other param is
 * bound once by the caller (a composition root), mirroring `EvaluateReleaseEligibilityForIntent`;
 * only `releaseIntentId` is supplied per call. */
export type EvaluateReleasePullRequestEligibilityForIntent = (
  releaseIntentId: string,
) => Promise<ReleasePullRequestEligibilityOutcome>;

export interface ExecuteEligibleReleasePullRequestParams {
  releaseIntentId: string;
  /** Selects one of the two trusted bases — this module always acts on exactly one target per
   * call, so a crash after the `main` PR is created never blocks a retry from independently
   * executing `develop` alone (see `releasePullRequestCompletionController.ts`). */
  target: ReleasePullRequestTarget;
  /** Re-run fresh, immediately before any mutation attempt — never a cached/prior eligibility
   * result. A previous eligibility result must never become a standing create/reuse approval. */
  evaluateReleasePullRequestEligibility: EvaluateReleasePullRequestEligibilityForIntent;
  /** The one-shot GitHub create/reuse leaf (`fetchImpl`/`mintCredential` already bound at
   * composition). Called at most once per invocation, only when eligibility is fresh and positive. */
  createOrReuseGithubPullRequest: CreateOrReuseGithubPullRequest;
  /** The one-shot fresh-observation primitive, used to independently re-verify the create/reuse
   * result — never trusted from the create/reuse response object alone. */
  observeGithubPullRequest: ObserveGithubPullRequest;
  logger?: ExecutorLogger;
}

export type ExecuteEligibleReleasePullRequestOutcome =
  | {
      outcome: "verified";
      releaseIntentId: string;
      repository: string;
      version: string;
      /** Threaded through from eligibility only for the completion controller's durable-identity
       * cross-check — never used by this module for any verification decision. */
      sourceBranch: string;
      sourceRevision: string;
      target: ReleasePullRequestTarget;
      releaseBranch: string;
      releaseCommitSha: string;
      number: number;
    }
  | { outcome: "not_eligible"; releaseIntentId: string; target: ReleasePullRequestTarget; eligibility: NotEligibleOutcome }
  | ({
      outcome: "create_or_reuse_failed";
      releaseIntentId: string;
      repository: string;
      target: ReleasePullRequestTarget;
    } & Omit<CreateFailure, "ok">)
  | ({
      outcome: "verification_observation_failed";
      releaseIntentId: string;
      repository: string;
      target: ReleasePullRequestTarget;
      number: number;
    } & Omit<ObservationFailure, "ok">)
  | { outcome: "verification_base_repository_mismatch"; releaseIntentId: string; repository: string; target: ReleasePullRequestTarget; number: number }
  | { outcome: "verification_head_repository_mismatch"; releaseIntentId: string; repository: string; target: ReleasePullRequestTarget; number: number }
  | {
      outcome: "verification_head_ref_mismatch";
      releaseIntentId: string;
      repository: string;
      target: ReleasePullRequestTarget;
      number: number;
      expectedHeadRef: string;
      actualHeadRef: string;
    }
  | {
      outcome: "verification_head_sha_mismatch";
      releaseIntentId: string;
      repository: string;
      target: ReleasePullRequestTarget;
      number: number;
      expectedHeadSha: string;
      actualHeadSha: string;
    }
  | {
      outcome: "verification_base_ref_mismatch";
      releaseIntentId: string;
      repository: string;
      target: ReleasePullRequestTarget;
      number: number;
      expectedBaseRef: string;
      actualBaseRef: string;
    }
  | { outcome: "verification_state_invalid"; releaseIntentId: string; repository: string; target: ReleasePullRequestTarget; number: number };

/** Deterministic, ADA-controlled — carries no repository-influenced content, so it can never be
 * steered by anything other than the trusted `version`/`target`. */
export function buildReleasePullRequestTitle(version: string, target: ReleasePullRequestTarget): string {
  return `Release ${version} → ${target}`;
}

/** Contains only safe release metadata already trusted by the fresh eligibility result — never a
 * prompt, credential, or unrelated Firestore data. */
function buildReleasePullRequestBody(params: {
  releaseIntentId: string;
  version: string;
  releaseBranch: string;
  releaseCommitSha: string;
  sourceRevision: string;
  baseBranch: string;
}): string {
  return [
    "Created by ADA.",
    "",
    `- Release intent: ${params.releaseIntentId}`,
    `- Version: ${params.version}`,
    `- Release branch: ${params.releaseBranch}`,
    `- Release commit: ${params.releaseCommitSha}`,
    `- Source revision: ${params.sourceRevision}`,
    `- Base: ${params.baseBranch}`,
  ].join("\n");
}

/**
 * Attempts exactly one guarded create-or-reuse of the release Pull Request for one trusted
 * `target` (`main` or `develop`) of the exact durable `releaseIntentId` freshly proves eligible —
 * the orchestration boundary above `createOrReuseGithubPullRequest` /
 * `observeGithubPullRequest`. Accepts only `releaseIntentId` plus `target` and injected
 * dependencies: the caller can never independently supply `repository` / branch / SHA — those are
 * taken solely from the fresh `evaluateReleasePullRequestEligibility(...)` result, so a stale or
 * forged identity can never steer the mutation.
 *
 * `evaluateReleasePullRequestEligibility` is always re-run at the start of this call, never reused
 * from an earlier check. An ineligible result performs no GitHub mutation.
 *
 * Once eligible, the PR title/body are built deterministically from trusted values only (release
 * intent id, version, release branch, release commit SHA, source revision, target base — never a
 * prompt, credential, or unrelated Firestore data), `createOrReuseGithubPullRequest` is called
 * exactly once (its own internal lookup/422-race handling makes this idempotent against a
 * concurrent attempt), and — critically — the create/reuse response is never trusted directly: the
 * resulting PR number is freshly re-observed via `observeGithubPullRequest` and its repository /
 * head repository / head ref / head SHA / base ref / state are independently verified against the
 * trusted eligibility values before this call reports success. Any disagreement — including a
 * fork, a retargeted base, a drifted head, or an already-closed/merged PR — fails closed with its
 * own distinct `verification_*` reason; a manually-created or contradictory PR that happens to
 * share a number is never adopted as trusted evidence.
 */
export async function executeEligibleReleasePullRequest(
  params: ExecuteEligibleReleasePullRequestParams,
): Promise<ExecuteEligibleReleasePullRequestOutcome> {
  const { releaseIntentId, target, evaluateReleasePullRequestEligibility, createOrReuseGithubPullRequest, observeGithubPullRequest, logger } =
    params;

  const eligibility = await evaluateReleasePullRequestEligibility(releaseIntentId);
  if (!eligibility.eligible) {
    logger?.error("Release PR execution refused: not currently eligible.", { releaseIntentId, target, reason: eligibility.reason });
    return { outcome: "not_eligible", releaseIntentId, target, eligibility };
  }

  const { repository, version, sourceBranch, sourceRevision, releaseBranch, releaseCommitSha } = eligibility;
  const safeIdentifiers = { releaseIntentId, repository, target };

  const title = buildReleasePullRequestTitle(version, target);
  const body = buildReleasePullRequestBody({ releaseIntentId, version, releaseBranch, releaseCommitSha, sourceRevision, baseBranch: target });

  const createOutcome = await createOrReuseGithubPullRequest({ repository, head: releaseBranch, base: target, title, body });
  if (!createOutcome.ok) {
    logger?.error("Release PR execution failed: create/reuse failed.", { ...safeIdentifiers, reason: createOutcome.reason });
    const { ok: _ok, ...failure } = createOutcome;
    void _ok;
    return { outcome: "create_or_reuse_failed", releaseIntentId, repository, target, ...failure };
  }

  const { number } = createOutcome;
  const verifyIdentifiers = { ...safeIdentifiers, number };

  const observation = await observeGithubPullRequest({ repository, pullRequestNumber: number });
  if (!observation.ok) {
    logger?.error("Release PR execution failed: fresh verification observation failed.", { ...verifyIdentifiers, reason: observation.reason });
    const { ok: _ok, ...failure } = observation;
    void _ok;
    return { outcome: "verification_observation_failed", releaseIntentId, repository, target, number, ...failure };
  }

  const pr = observation.pullRequest;

  if (pr.baseRepositoryFullName !== repository) {
    logger?.error("Release PR execution failed: fresh verification found a base repository mismatch.", verifyIdentifiers);
    return { outcome: "verification_base_repository_mismatch", releaseIntentId, repository, target, number };
  }
  if (pr.headRepositoryFullName !== repository) {
    logger?.error("Release PR execution failed: fresh verification found a head repository mismatch (e.g. a fork).", verifyIdentifiers);
    return { outcome: "verification_head_repository_mismatch", releaseIntentId, repository, target, number };
  }
  if (pr.headRef !== releaseBranch) {
    logger?.error("Release PR execution failed: fresh verification found a head ref mismatch.", verifyIdentifiers);
    return { outcome: "verification_head_ref_mismatch", releaseIntentId, repository, target, number, expectedHeadRef: releaseBranch, actualHeadRef: pr.headRef };
  }
  if (pr.headSha !== releaseCommitSha) {
    logger?.error("Release PR execution failed: fresh verification found a head SHA mismatch.", verifyIdentifiers);
    return {
      outcome: "verification_head_sha_mismatch",
      releaseIntentId,
      repository,
      target,
      number,
      expectedHeadSha: releaseCommitSha,
      actualHeadSha: pr.headSha,
    };
  }
  if (pr.baseRef !== target) {
    logger?.error("Release PR execution failed: fresh verification found a base ref mismatch (retargeted).", verifyIdentifiers);
    return { outcome: "verification_base_ref_mismatch", releaseIntentId, repository, target, number, expectedBaseRef: target, actualBaseRef: pr.baseRef };
  }
  if (pr.state !== "open" || pr.merged) {
    logger?.error("Release PR execution failed: fresh verification found the pull request is not open.", verifyIdentifiers);
    return { outcome: "verification_state_invalid", releaseIntentId, repository, target, number };
  }

  logger?.info("Release PR execution succeeded: create/reuse result freshly verified.", { ...verifyIdentifiers, releaseBranch });
  return { outcome: "verified", releaseIntentId, repository, version, sourceBranch, sourceRevision, target, releaseBranch, releaseCommitSha, number };
}
