import { describe, expect, it, vi } from "vitest";

import { runReleaseCiController } from "./releaseCiController";

import type { ObserveReleaseCiForReleasePullRequestOutcome } from "./releasePullRequestCiObservation";
import type { RecordReleaseCiResultOutcome } from "./releaseIntentRepository";
import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ReleasePullRequestTarget } from "./schemas/releaseIntentDocument";

const RELEASE_INTENT_ID = "johnpwise__kanban-app--0.2.0";
const MAIN_PR_NUMBER = 101;
const DEVELOP_PR_NUMBER = 102;

const DEFAULT_POLICY = { maxRounds: 5, delayMs: 1_000 };

function ciPending(target: ReleasePullRequestTarget, number: number): ObserveReleaseCiForReleasePullRequestOutcome {
  return { outcome: "ci_pending", releaseIntentId: RELEASE_INTENT_ID, target, number };
}

function ciSucceeded(target: ReleasePullRequestTarget, number: number, runId: number): ObserveReleaseCiForReleasePullRequestOutcome {
  return {
    outcome: "ci_succeeded",
    releaseIntentId: RELEASE_INTENT_ID,
    target,
    number,
    runId,
    htmlUrl: `https://github.com/johnpwise/kanban-app/actions/runs/${runId}`,
  };
}

function ciFailed(target: ReleasePullRequestTarget, number: number, runId: number): ObserveReleaseCiForReleasePullRequestOutcome {
  return {
    outcome: "ci_failed",
    releaseIntentId: RELEASE_INTENT_ID,
    target,
    number,
    runId,
    htmlUrl: `https://github.com/johnpwise/kanban-app/actions/runs/${runId}`,
    conclusion: "failure",
  };
}

function ciUnbound(target: ReleasePullRequestTarget, number: number): ObserveReleaseCiForReleasePullRequestOutcome {
  return { outcome: "ci_unbound", releaseIntentId: RELEASE_INTENT_ID, target, number };
}

/** Queues per-target outcome sequences; each call to a target consumes its next queued outcome and
 * throws if the queue for that target is exhausted — proof the round loop never over-polls a
 * target beyond what the test expects. */
function createFakeObservation(queues: Record<ReleasePullRequestTarget, ObserveReleaseCiForReleasePullRequestOutcome[]>) {
  const calls: ReleasePullRequestTarget[] = [];
  const cursors: Record<ReleasePullRequestTarget, number> = { main: 0, develop: 0 };
  const observe = vi.fn(async (_releaseIntentId: string, target: ReleasePullRequestTarget) => {
    calls.push(target);
    const queue = queues[target];
    const index = cursors[target];
    if (index >= queue.length) {
      throw new Error(`observeReleaseCiForReleasePullRequest(${target}) called more times than the test queued outcomes for.`);
    }
    cursors[target] = index + 1;
    return queue[index];
  });
  return { observe, calls };
}

function createFakeRepository(behavior: {
  recordReleaseCiResult?: (identity: { target: ReleasePullRequestTarget }) => RecordReleaseCiResultOutcome;
  throwErrorForTarget?: ReleasePullRequestTarget;
}) {
  const recordCalls: { releaseIntentId: string; identity: { target: ReleasePullRequestTarget; number: number; state: string; runId: number } }[] = [];
  const repository = {
    async recordReleaseCiResult(releaseIntentId: string, identity: never) {
      recordCalls.push({ releaseIntentId, identity });
      if (behavior.throwErrorForTarget && (identity as { target: ReleasePullRequestTarget }).target === behavior.throwErrorForTarget) {
        throw new Error("firestore unavailable");
      }
      return behavior.recordReleaseCiResult?.(identity as { target: ReleasePullRequestTarget }) ?? { outcome: "created" };
    },
  } as unknown as ReleaseIntentRepository;
  return { repository, recordCalls };
}

function createFakeWait() {
  const calls: number[] = [];
  const wait = async (delayMs: number) => {
    calls.push(delayMs);
  };
  return { wait, calls };
}

describe("runReleaseCiController", () => {
  it("records a succeeded CI result for both targets on the first round with no waiting", async () => {
    // Arrange
    const { observe, calls } = createFakeObservation({
      main: [ciSucceeded("main", MAIN_PR_NUMBER, 501)],
      develop: [ciSucceeded("develop", DEVELOP_PR_NUMBER, 502)],
    });
    const { repository, recordCalls } = createFakeRepository({});
    const { wait, calls: waitCalls } = createFakeWait();

    // Act
    const outcome = await runReleaseCiController({
      releaseIntentId: RELEASE_INTENT_ID,
      observeReleaseCiForReleasePullRequest: observe,
      repository,
      wait,
      policy: DEFAULT_POLICY,
    });

    // Assert
    expect(outcome.main).toEqual({
      outcome: "release_ci_succeeded_recorded",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
      runId: 501,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/501",
      rounds: 1,
    });
    expect(outcome.develop).toEqual({
      outcome: "release_ci_succeeded_recorded",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "develop",
      number: DEVELOP_PR_NUMBER,
      runId: 502,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/502",
      rounds: 1,
    });
    expect(calls).toEqual(["main", "develop"]);
    expect(recordCalls).toHaveLength(2);
    expect(waitCalls).toEqual([]);
  });

  it("records a failed CI result distinctly from a succeeded one, with its conclusion", async () => {
    // Arrange
    const { observe } = createFakeObservation({
      main: [ciFailed("main", MAIN_PR_NUMBER, 501)],
      develop: [ciSucceeded("develop", DEVELOP_PR_NUMBER, 502)],
    });
    const { repository } = createFakeRepository({});
    const { wait } = createFakeWait();

    // Act
    const outcome = await runReleaseCiController({
      releaseIntentId: RELEASE_INTENT_ID,
      observeReleaseCiForReleasePullRequest: observe,
      repository,
      wait,
      policy: DEFAULT_POLICY,
    });

    // Assert
    expect(outcome.main).toEqual({
      outcome: "release_ci_failed_recorded",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      number: MAIN_PR_NUMBER,
      runId: 501,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/501",
      conclusion: "failure",
      rounds: 1,
    });
  });

  it("reports release_ci_*_already_recorded distinctly from a fresh recording", async () => {
    // Arrange
    const { observe } = createFakeObservation({
      main: [ciSucceeded("main", MAIN_PR_NUMBER, 501)],
      develop: [ciSucceeded("develop", DEVELOP_PR_NUMBER, 502)],
    });
    const { repository } = createFakeRepository({ recordReleaseCiResult: () => ({ outcome: "already_recorded" }) });
    const { wait } = createFakeWait();

    // Act
    const outcome = await runReleaseCiController({
      releaseIntentId: RELEASE_INTENT_ID,
      observeReleaseCiForReleasePullRequest: observe,
      repository,
      wait,
      policy: DEFAULT_POLICY,
    });

    // Assert
    expect(outcome.main.outcome).toBe("release_ci_succeeded_already_recorded");
    expect(outcome.develop.outcome).toBe("release_ci_succeeded_already_recorded");
  });

  it("continues polling a still-pending target across rounds while the other target has already reached a terminal state, and stops polling the terminal one", async () => {
    // Arrange — develop resolves in round 1; main stays pending until round 3.
    const { observe, calls } = createFakeObservation({
      main: [ciPending("main", MAIN_PR_NUMBER), ciPending("main", MAIN_PR_NUMBER), ciSucceeded("main", MAIN_PR_NUMBER, 501)],
      develop: [ciSucceeded("develop", DEVELOP_PR_NUMBER, 502)],
    });
    const { repository } = createFakeRepository({});
    const { wait, calls: waitCalls } = createFakeWait();

    // Act
    const outcome = await runReleaseCiController({
      releaseIntentId: RELEASE_INTENT_ID,
      observeReleaseCiForReleasePullRequest: observe,
      repository,
      wait,
      policy: DEFAULT_POLICY,
    });

    // Assert
    expect(outcome.main).toMatchObject({ outcome: "release_ci_succeeded_recorded", rounds: 3 });
    expect(outcome.develop).toMatchObject({ outcome: "release_ci_succeeded_recorded", rounds: 1 });
    // develop is only ever observed once — never polled again after round 1.
    expect(calls.filter((t) => t === "develop")).toHaveLength(1);
    expect(calls.filter((t) => t === "main")).toHaveLength(3);
    expect(waitCalls).toEqual([1_000, 1_000]);
  });

  it("finalizes ci_unbound immediately for a target, with no further polling of that target, while the other target continues independently", async () => {
    // Arrange
    const { observe, calls } = createFakeObservation({
      main: [ciUnbound("main", MAIN_PR_NUMBER)],
      develop: [ciPending("develop", DEVELOP_PR_NUMBER), ciSucceeded("develop", DEVELOP_PR_NUMBER, 502)],
    });
    const { repository, recordCalls } = createFakeRepository({});
    const { wait } = createFakeWait();

    // Act
    const outcome = await runReleaseCiController({
      releaseIntentId: RELEASE_INTENT_ID,
      observeReleaseCiForReleasePullRequest: observe,
      repository,
      wait,
      policy: DEFAULT_POLICY,
    });

    // Assert
    expect(outcome.main).toEqual({ outcome: "ci_unbound", releaseIntentId: RELEASE_INTENT_ID, target: "main", number: MAIN_PR_NUMBER, rounds: 1 });
    expect(outcome.develop).toMatchObject({ outcome: "release_ci_succeeded_recorded", rounds: 2 });
    expect(calls.filter((t) => t === "main")).toHaveLength(1);
    // recordReleaseCiResult is never called for the unbound target.
    expect(recordCalls.every((call) => call.identity.target !== "main")).toBe(true);
  });

  it("passes through every fail-closed observation outcome verbatim, stopping polling for that target", async () => {
    // Arrange
    const { observe, calls } = createFakeObservation({
      main: [{ outcome: "release_pull_request_missing", releaseIntentId: RELEASE_INTENT_ID, target: "main" }],
      develop: [ciSucceeded("develop", DEVELOP_PR_NUMBER, 502)],
    });
    const { repository } = createFakeRepository({});
    const { wait } = createFakeWait();

    // Act
    const outcome = await runReleaseCiController({
      releaseIntentId: RELEASE_INTENT_ID,
      observeReleaseCiForReleasePullRequest: observe,
      repository,
      wait,
      policy: DEFAULT_POLICY,
    });

    // Assert
    expect(outcome.main).toEqual({ outcome: "release_pull_request_missing", releaseIntentId: RELEASE_INTENT_ID, target: "main", rounds: 1 });
    expect(calls.filter((t) => t === "main")).toHaveLength(1);
  });

  it("finalizes a persistence conflict distinctly, without ever mutating the other target's own outcome", async () => {
    // Arrange
    const { observe } = createFakeObservation({
      main: [ciSucceeded("main", MAIN_PR_NUMBER, 501)],
      develop: [ciSucceeded("develop", DEVELOP_PR_NUMBER, 502)],
    });
    const { repository } = createFakeRepository({
      recordReleaseCiResult: (identity) => (identity.target === "main" ? { outcome: "conflict" } : { outcome: "created" }),
    });
    const { wait } = createFakeWait();

    // Act
    const outcome = await runReleaseCiController({
      releaseIntentId: RELEASE_INTENT_ID,
      observeReleaseCiForReleasePullRequest: observe,
      repository,
      wait,
      policy: DEFAULT_POLICY,
    });

    // Assert
    expect(outcome.main).toEqual({ outcome: "release_ci_result_conflict", releaseIntentId: RELEASE_INTENT_ID, target: "main", rounds: 1 });
    expect(outcome.develop).toMatchObject({ outcome: "release_ci_succeeded_recorded" });
  });

  it("finalizes a persistence error distinctly when recordReleaseCiResult throws unexpectedly", async () => {
    // Arrange
    const { observe } = createFakeObservation({
      main: [ciSucceeded("main", MAIN_PR_NUMBER, 501)],
      develop: [ciSucceeded("develop", DEVELOP_PR_NUMBER, 502)],
    });
    const { repository } = createFakeRepository({ throwErrorForTarget: "main" });
    const { wait } = createFakeWait();

    // Act
    const outcome = await runReleaseCiController({
      releaseIntentId: RELEASE_INTENT_ID,
      observeReleaseCiForReleasePullRequest: observe,
      repository,
      wait,
      policy: DEFAULT_POLICY,
    });

    // Assert
    expect(outcome.main).toEqual({ outcome: "release_ci_result_persistence_error", releaseIntentId: RELEASE_INTENT_ID, target: "main", rounds: 1 });
    expect(outcome.develop).toMatchObject({ outcome: "release_ci_succeeded_recorded" });
  });

  it("propagates every recordReleaseCiResult lifecycle-failure outcome as its own distinct target outcome", async () => {
    // Arrange
    const { observe } = createFakeObservation({
      main: [ciSucceeded("main", MAIN_PR_NUMBER, 501)],
      develop: [ciSucceeded("develop", DEVELOP_PR_NUMBER, 502)],
    });
    const { repository } = createFakeRepository({
      recordReleaseCiResult: (identity) =>
        identity.target === "main" ? { outcome: "release_pull_request_identity_mismatch" } : { outcome: "release_intent_not_found" },
    });
    const { wait } = createFakeWait();

    // Act
    const outcome = await runReleaseCiController({
      releaseIntentId: RELEASE_INTENT_ID,
      observeReleaseCiForReleasePullRequest: observe,
      repository,
      wait,
      policy: DEFAULT_POLICY,
    });

    // Assert
    expect(outcome.main).toEqual({
      outcome: "release_ci_result_pull_request_identity_mismatch",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "main",
      rounds: 1,
    });
    expect(outcome.develop).toEqual({
      outcome: "release_ci_result_intent_not_found",
      releaseIntentId: RELEASE_INTENT_ID,
      target: "develop",
      rounds: 1,
    });
  });

  it("exhausts the bounded round window when a target stays pending forever, without exceeding maxRounds observations for it", async () => {
    // Arrange
    const { observe, calls } = createFakeObservation({
      main: [ciPending("main", MAIN_PR_NUMBER), ciPending("main", MAIN_PR_NUMBER), ciPending("main", MAIN_PR_NUMBER)],
      develop: [ciSucceeded("develop", DEVELOP_PR_NUMBER, 502)],
    });
    const { repository } = createFakeRepository({});
    const { wait, calls: waitCalls } = createFakeWait();

    // Act
    const outcome = await runReleaseCiController({
      releaseIntentId: RELEASE_INTENT_ID,
      observeReleaseCiForReleasePullRequest: observe,
      repository,
      wait,
      policy: { maxRounds: 3, delayMs: 500 },
    });

    // Assert
    expect(outcome.main).toEqual({ outcome: "release_ci_exhausted", releaseIntentId: RELEASE_INTENT_ID, target: "main", rounds: 3 });
    expect(outcome.develop).toMatchObject({ outcome: "release_ci_succeeded_recorded", rounds: 1 });
    expect(calls.filter((t) => t === "main")).toHaveLength(3);
    // Waits only between rounds while a target remains unresolved, never after the last round.
    expect(waitCalls).toEqual([500, 500]);
  });

  it("never sleeps for real — the injected wait is the only source of delay", async () => {
    const { observe } = createFakeObservation({
      main: [ciPending("main", MAIN_PR_NUMBER), ciSucceeded("main", MAIN_PR_NUMBER, 501)],
      develop: [ciSucceeded("develop", DEVELOP_PR_NUMBER, 502)],
    });
    const { repository } = createFakeRepository({});
    const { wait } = createFakeWait();

    const start = Date.now();
    await runReleaseCiController({
      releaseIntentId: RELEASE_INTENT_ID,
      observeReleaseCiForReleasePullRequest: observe,
      repository,
      wait,
      policy: { maxRounds: 5, delayMs: 60_000 },
    });
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});
