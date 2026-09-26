import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ObserveReleaseCiForReleasePullRequestOutcome } from "./releasePullRequestCiObservation";
import type { ReleasePullRequestTarget } from "./schemas/releaseIntentDocument";
import type { ExecutorLogger } from "./runExecutor";

/** Every observation outcome that finalizes a target immediately, with no further polling and no
 * persistence attempt: `ci_unbound` (untrusted evidence exists — never treated as pending, never
 * retried), plus every release-intent/pull-request-reconciliation/CI-observation failure
 * `observeReleaseCiForReleasePullRequest` (PR #66) can report. Passed through verbatim — this
 * controller never reinterprets, weakens, or adds retry to that established fail-closed contract. */
type ObservationPassthroughOutcome = Exclude<
  ObserveReleaseCiForReleasePullRequestOutcome,
  { outcome: "ci_pending" } | { outcome: "ci_succeeded" } | { outcome: "ci_failed" }
>;

/** A composition-bound closure over `observeReleaseCiForReleasePullRequest` — every other param
 * (`repository`/`observeGithubPullRequest`/`observeReleaseCiStatus`) is bound once by the caller (a
 * composition root); `releaseIntentId`/`target` are supplied per call, mirroring
 * `ExecuteEligibleReleasePullRequestForIntent`. Called fresh on every round for every
 * still-unresolved target — never a cached prior observation. */
export type ObserveReleaseCiForReleasePullRequestForIntent = (
  releaseIntentId: string,
  target: ReleasePullRequestTarget,
) => Promise<ObserveReleaseCiForReleasePullRequestOutcome>;

export interface ReleaseCiControllerPolicy {
  /** Hard bound on the number of observation rounds this run will make. Each round observes every
   * still-unresolved target, so this bounds the whole two-target stage, not one target alone. */
  maxRounds: number;
  /** Delay passed to the injected `wait` between two consecutive rounds while at least one target
   * remains unresolved. */
  delayMs: number;
}

export interface RunReleaseCiControllerParams {
  releaseIntentId: string;
  /** The release-PR-anchored, fresh-reconciliation observation primitive (PR #66), re-run fresh for
   * each unresolved target on every round — never a cached prior observation. */
  observeReleaseCiForReleasePullRequest: ObserveReleaseCiForReleasePullRequestForIntent;
  /** Reused unmodified — only `recordReleaseCiResult` is called; never a read. */
  repository: ReleaseIntentRepository;
  /** Injected so tests are deterministic and perform no real sleeping. */
  wait: (delayMs: number) => Promise<void>;
  policy: ReleaseCiControllerPolicy;
  logger?: ExecutorLogger;
}

export type ReleaseCiTargetOutcome =
  | {
      outcome: "release_ci_succeeded_recorded" | "release_ci_succeeded_already_recorded";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      number: number;
      runId: number;
      htmlUrl: string;
      rounds: number;
    }
  | {
      outcome: "release_ci_failed_recorded" | "release_ci_failed_already_recorded";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      number: number;
      runId: number;
      htmlUrl: string;
      conclusion: string;
      rounds: number;
    }
  | { outcome: "release_ci_result_conflict"; releaseIntentId: string; target: ReleasePullRequestTarget; rounds: number }
  | { outcome: "release_ci_result_persistence_error"; releaseIntentId: string; target: ReleasePullRequestTarget; rounds: number }
  | { outcome: "release_ci_result_intent_not_found"; releaseIntentId: string; target: ReleasePullRequestTarget; rounds: number }
  | { outcome: "release_ci_result_intent_invalid"; releaseIntentId: string; target: ReleasePullRequestTarget; rounds: number }
  | { outcome: "release_ci_result_pull_request_missing"; releaseIntentId: string; target: ReleasePullRequestTarget; rounds: number }
  | {
      outcome: "release_ci_result_pull_request_identity_mismatch";
      releaseIntentId: string;
      target: ReleasePullRequestTarget;
      rounds: number;
    }
  | { outcome: "release_ci_exhausted"; releaseIntentId: string; target: ReleasePullRequestTarget; rounds: number }
  | (ObservationPassthroughOutcome & { rounds: number });

export interface ReleaseCiControllerOutcome {
  releaseIntentId: string;
  main: ReleaseCiTargetOutcome;
  develop: ReleaseCiTargetOutcome;
  rounds: number;
}

const TARGETS: ReleasePullRequestTarget[] = ["main", "develop"];

/**
 * Attempts to finalize one target from a single fresh observation. Returns `undefined` only for
 * `ci_pending` — the sole outcome that keeps a target in the next round. Every other outcome is
 * terminal for this target: a genuine `ci_succeeded`/`ci_failed` is durably persisted via
 * `repository.recordReleaseCiResult` before being reported (persistence failure/conflict/lifecycle
 * mismatch is reported as its own distinct, fail-closed outcome instead of a successful recording);
 * `ci_unbound` and every reconciliation/observation failure from PR #66's
 * `observeReleaseCiForReleasePullRequest` pass through verbatim, never retried.
 */
async function finalizeTarget(
  releaseIntentId: string,
  target: ReleasePullRequestTarget,
  observation: ObserveReleaseCiForReleasePullRequestOutcome,
  repository: ReleaseIntentRepository,
  round: number,
  logger?: ExecutorLogger,
): Promise<ReleaseCiTargetOutcome | undefined> {
  if (observation.outcome === "ci_pending") {
    return undefined;
  }

  if (observation.outcome !== "ci_succeeded" && observation.outcome !== "ci_failed") {
    logger?.error("Release CI observation finalized this target without a trusted terminal result.", {
      releaseIntentId,
      target,
      round,
      observationOutcome: observation.outcome,
    });
    return { ...observation, rounds: round };
  }

  const state = observation.outcome === "ci_succeeded" ? ("succeeded" as const) : ("failed" as const);
  const safeIdentifiers = { releaseIntentId, target, round, number: observation.number, runId: observation.runId };

  let persistOutcome;
  try {
    persistOutcome = await repository.recordReleaseCiResult(releaseIntentId, {
      target,
      number: observation.number,
      state,
      runId: observation.runId,
      htmlUrl: observation.htmlUrl,
      ...(observation.outcome === "ci_failed" ? { conclusion: observation.conclusion } : {}),
    });
  } catch {
    logger?.error("Unexpected failure durably persisting the release CI result.", safeIdentifiers);
    return { outcome: "release_ci_result_persistence_error", releaseIntentId, target, rounds: round };
  }

  switch (persistOutcome.outcome) {
    case "conflict":
      logger?.error("A conflicting release CI result is already durably persisted for this target.", safeIdentifiers);
      return { outcome: "release_ci_result_conflict", releaseIntentId, target, rounds: round };
    case "release_intent_not_found":
      logger?.error("Cannot persist the release CI result: no such release intent.", safeIdentifiers);
      return { outcome: "release_ci_result_intent_not_found", releaseIntentId, target, rounds: round };
    case "release_intent_invalid":
      logger?.error("Cannot persist the release CI result: the persisted release intent document failed schema validation.", safeIdentifiers);
      return { outcome: "release_ci_result_intent_invalid", releaseIntentId, target, rounds: round };
    case "release_pull_request_missing":
      logger?.error("Cannot persist the release CI result: no durable release pull request result is persisted for this target.", safeIdentifiers);
      return { outcome: "release_ci_result_pull_request_missing", releaseIntentId, target, rounds: round };
    case "release_pull_request_identity_mismatch":
      logger?.error("Cannot persist the release CI result: the persisted pull request identity has changed since CI was observed.", safeIdentifiers);
      return { outcome: "release_ci_result_pull_request_identity_mismatch", releaseIntentId, target, rounds: round };
    case "created":
    case "already_recorded": {
      const recorded = persistOutcome.outcome === "created";
      logger?.info(
        recorded ? "Release CI result durably recorded." : "Release CI result already durably recorded — safe convergence.",
        { ...safeIdentifiers, state },
      );
      if (observation.outcome === "ci_succeeded") {
        return {
          outcome: recorded ? "release_ci_succeeded_recorded" : "release_ci_succeeded_already_recorded",
          releaseIntentId,
          target,
          number: observation.number,
          runId: observation.runId,
          htmlUrl: observation.htmlUrl,
          rounds: round,
        };
      }
      return {
        outcome: recorded ? "release_ci_failed_recorded" : "release_ci_failed_already_recorded",
        releaseIntentId,
        target,
        number: observation.number,
        runId: observation.runId,
        htmlUrl: observation.htmlUrl,
        conclusion: observation.conclusion,
        rounds: round,
      };
    }
  }
}

/**
 * The bounded, round-based orchestration boundary above `observeReleaseCiForReleasePullRequest`
 * (PR #66): independently waits for, verifies, and durably records the trusted terminal CI result
 * for both `main` and `develop`. Each round observes every target that has not yet reached a
 * terminal outcome — never `poll main until timeout, then poll develop` — so the two targets are
 * never serialized against each other. A target that reaches a durably persisted terminal state
 * (`ci_succeeded`/`ci_failed`), `ci_unbound`, or any fail-closed reconciliation/observation failure
 * is finalized immediately and excluded from every subsequent round; a failure finalizing one
 * target never prevents the other from being observed, persisted, or reported in the same or a
 * later round. Exactly one `wait()` per round (never per target), and only when at least one target
 * remains unresolved and rounds remain. A target still `ci_pending` when `policy.maxRounds` is
 * exhausted is reported as `release_ci_exhausted` — never a fabricated terminal state.
 */
export async function runReleaseCiController(params: RunReleaseCiControllerParams): Promise<ReleaseCiControllerOutcome> {
  const { releaseIntentId, observeReleaseCiForReleasePullRequest, repository, wait, policy, logger } = params;

  const finalized: Partial<Record<ReleasePullRequestTarget, ReleaseCiTargetOutcome>> = {};
  let roundsUsed = 0;

  for (let round = 1; round <= policy.maxRounds; round++) {
    roundsUsed = round;
    const pendingTargets = TARGETS.filter((target) => !finalized[target]);
    if (pendingTargets.length === 0) {
      break;
    }

    for (const target of pendingTargets) {
      const observation = await observeReleaseCiForReleasePullRequest(releaseIntentId, target);
      const result = await finalizeTarget(releaseIntentId, target, observation, repository, round, logger);
      if (result) {
        finalized[target] = result;
      }
    }

    const stillUnresolved = TARGETS.some((target) => !finalized[target]);
    if (!stillUnresolved) {
      break;
    }
    if (round < policy.maxRounds) {
      await wait(policy.delayMs);
    }
  }

  for (const target of TARGETS) {
    if (!finalized[target]) {
      logger?.error("Exhausted the bounded release CI round window while this target remained pending.", {
        releaseIntentId,
        target,
        rounds: roundsUsed,
      });
      finalized[target] = { outcome: "release_ci_exhausted", releaseIntentId, target, rounds: roundsUsed };
    }
  }

  return { releaseIntentId, main: finalized.main!, develop: finalized.develop!, rounds: roundsUsed };
}
