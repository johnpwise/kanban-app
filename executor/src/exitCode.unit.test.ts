import { describe, expect, it } from "vitest";

import {
  exitCodeForCiControllerOutcome,
  exitCodeForMergeControllerOutcome,
  exitCodeForOutcome,
  exitCodeForReleaseCiControllerOutcome,
  exitCodeForReleaseControllerOutcome,
  exitCodeForReleasePullRequestControllerOutcome,
} from "./exitCode";

describe("exitCodeForOutcome", () => {
  it("returns 0 for a successful outcome", () => {
    // Arrange
    const outcome = { ok: true as const, claimed: true };

    // Act
    const code = exitCodeForOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns a non-zero code for a failed outcome", () => {
    // Arrange
    const outcome = { ok: false as const, reason: "not_found" };

    // Act
    const code = exitCodeForOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });
});

describe("exitCodeForCiControllerOutcome", () => {
  it("returns 0 when CI succeeded", () => {
    // Arrange
    const outcome = { outcome: "ci_succeeded" as const, runId: 1, htmlUrl: "https://example.com", observationCount: 1 };

    // Act
    const code = exitCodeForCiControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns 0 when CI genuinely failed (the controller itself still succeeded at its job)", () => {
    // Arrange
    const outcome = {
      outcome: "ci_failed" as const,
      runId: 1,
      htmlUrl: "https://example.com",
      conclusion: "failure",
      observationCount: 1,
    };

    // Act
    const code = exitCodeForCiControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns a non-zero code when the controller itself could not reach a terminal result", () => {
    // Arrange
    const outcome = { outcome: "exhausted" as const, observationCount: 3 };

    // Act
    const code = exitCodeForCiControllerOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });

  it("returns a non-zero code when the persisted execution run could not be loaded", () => {
    // Arrange
    const outcome = { outcome: "execution_run_not_found" as const };

    // Act
    const code = exitCodeForCiControllerOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });
});

describe("exitCodeForMergeControllerOutcome", () => {
  it("returns 0 for a freshly completed merge", () => {
    // Arrange
    const outcome = {
      outcome: "merged" as const,
      executionRunId: "req-1",
      repository: "johnpwise/kanban-app",
      pullRequestNumber: 1,
      deliveryCommitSha: "a".repeat(40),
      mergeCommitSha: "c".repeat(40),
    };

    // Act
    const code = exitCodeForMergeControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns 0 for an idempotently converged already-recorded merge", () => {
    // Arrange
    const outcome = {
      outcome: "merge_already_recorded" as const,
      executionRunId: "req-1",
      repository: "johnpwise/kanban-app",
      pullRequestNumber: 1,
      deliveryCommitSha: "a".repeat(40),
      mergeCommitSha: "c".repeat(40),
    };

    // Act
    const code = exitCodeForMergeControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns a non-zero code for an ineligible outcome", () => {
    // Arrange
    const outcome = {
      outcome: "not_eligible" as const,
      executionRunId: "req-1",
      eligibility: { eligible: false as const, reason: "not_mergeable" as const },
    };

    // Act
    const code = exitCodeForMergeControllerOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });

  it("returns a non-zero code when the bounded mergeability-pending retry is exhausted", () => {
    // Arrange
    const outcome = { outcome: "mergeability_retry_exhausted" as const, executionRunId: "req-1", attempts: 5 };

    // Act
    const code = exitCodeForMergeControllerOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });

  it("returns a non-zero code when persistence of the merge result fails", () => {
    // Arrange
    const outcome = { outcome: "merge_result_persistence_error" as const, executionRunId: "req-1" };

    // Act
    const code = exitCodeForMergeControllerOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });
});

describe("exitCodeForReleaseControllerOutcome", () => {
  it("returns 0 for a freshly completed release-start", () => {
    // Arrange
    const outcome = {
      outcome: "started" as const,
      releaseIntentId: "johnpwise__kanban-app--0.2.0",
      repository: "johnpwise/kanban-app",
      version: "0.2.0",
      sourceBranch: "develop",
      sourceRevision: "a".repeat(40),
      releaseBranch: "release/0.2.0",
      commitSha: "b".repeat(40),
    };

    // Act
    const code = exitCodeForReleaseControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns 0 for an idempotently converged already-recorded release-start", () => {
    // Arrange
    const outcome = {
      outcome: "release_start_already_recorded" as const,
      releaseIntentId: "johnpwise__kanban-app--0.2.0",
      repository: "johnpwise/kanban-app",
      version: "0.2.0",
      sourceBranch: "develop",
      sourceRevision: "a".repeat(40),
      releaseBranch: "release/0.2.0",
      commitSha: "b".repeat(40),
    };

    // Act
    const code = exitCodeForReleaseControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns a non-zero code when release-start persistence fails", () => {
    // Arrange
    const outcome = { outcome: "release_start_persistence_error" as const, releaseIntentId: "id-1" };

    // Act
    const code = exitCodeForReleaseControllerOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });

  it("returns a non-zero code when the release intent could not be resolved/recorded", () => {
    // Arrange
    const outcome = {
      outcome: "release_intent_resolution_source_branch_observation_error" as const,
      releaseIntentId: "id-1",
    };

    // Act
    const code = exitCodeForReleaseControllerOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });
});

describe("exitCodeForReleasePullRequestControllerOutcome", () => {
  const RECORDED_MAIN = {
    outcome: "release_pull_request_recorded" as const,
    releaseIntentId: "johnpwise__kanban-app--0.2.0",
    target: "main" as const,
    repository: "johnpwise/kanban-app",
    version: "0.2.0",
    releaseBranch: "release/0.2.0",
    releaseCommitSha: "a".repeat(40),
    number: 101,
  };
  const RECORDED_DEVELOP = { ...RECORDED_MAIN, target: "develop" as const, number: 102 };
  const ALREADY_RECORDED_MAIN = { ...RECORDED_MAIN, outcome: "release_pull_request_already_recorded" as const };
  const ALREADY_RECORDED_DEVELOP = { ...RECORDED_DEVELOP, outcome: "release_pull_request_already_recorded" as const };

  it("returns 0 when both targets are freshly recorded", () => {
    // Arrange
    const outcome = { releaseIntentId: "johnpwise__kanban-app--0.2.0", main: RECORDED_MAIN, develop: RECORDED_DEVELOP };

    // Act
    const code = exitCodeForReleasePullRequestControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns 0 when both targets idempotently converge as already recorded", () => {
    // Arrange
    const outcome = { releaseIntentId: "johnpwise__kanban-app--0.2.0", main: ALREADY_RECORDED_MAIN, develop: ALREADY_RECORDED_DEVELOP };

    // Act
    const code = exitCodeForReleasePullRequestControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns 0 for a mix of freshly recorded and already-recorded targets", () => {
    // Arrange
    const outcome = { releaseIntentId: "johnpwise__kanban-app--0.2.0", main: ALREADY_RECORDED_MAIN, develop: RECORDED_DEVELOP };

    // Act
    const code = exitCodeForReleasePullRequestControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns a non-zero code when only one target reached a durable terminal result", () => {
    // Arrange
    const outcome = {
      releaseIntentId: "johnpwise__kanban-app--0.2.0",
      main: RECORDED_MAIN,
      develop: { outcome: "not_eligible" as const, releaseIntentId: "johnpwise__kanban-app--0.2.0", target: "develop" as const, eligibility: { eligible: false as const, reason: "release_start_missing" as const } },
    };

    // Act
    const code = exitCodeForReleasePullRequestControllerOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });

  it("returns a non-zero code when neither target reached a durable terminal result", () => {
    // Arrange
    const outcome = {
      releaseIntentId: "johnpwise__kanban-app--0.2.0",
      main: { outcome: "release_pull_request_persistence_error" as const, releaseIntentId: "johnpwise__kanban-app--0.2.0", target: "main" as const },
      develop: { outcome: "release_pull_request_conflict" as const, releaseIntentId: "johnpwise__kanban-app--0.2.0", target: "develop" as const },
    };

    // Act
    const code = exitCodeForReleasePullRequestControllerOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });
});

describe("exitCodeForReleaseCiControllerOutcome", () => {
  const RELEASE_INTENT_ID = "johnpwise__kanban-app--0.2.0";
  const SUCCEEDED_MAIN = {
    outcome: "release_ci_succeeded_recorded" as const,
    releaseIntentId: RELEASE_INTENT_ID,
    target: "main" as const,
    number: 101,
    runId: 501,
    htmlUrl: "https://example.com/runs/501",
    rounds: 1,
  };
  const SUCCEEDED_DEVELOP = { ...SUCCEEDED_MAIN, target: "develop" as const, number: 102, runId: 502 };
  const ALREADY_RECORDED_MAIN = { ...SUCCEEDED_MAIN, outcome: "release_ci_succeeded_already_recorded" as const };
  const FAILED_MAIN = {
    outcome: "release_ci_failed_recorded" as const,
    releaseIntentId: RELEASE_INTENT_ID,
    target: "main" as const,
    number: 101,
    runId: 501,
    htmlUrl: "https://example.com/runs/501",
    conclusion: "failure",
    rounds: 1,
  };
  const FAILED_ALREADY_RECORDED_DEVELOP = { ...FAILED_MAIN, outcome: "release_ci_failed_already_recorded" as const, target: "develop" as const };

  it("returns 0 when both targets durably recorded a succeeded CI result", () => {
    // Arrange
    const outcome = { releaseIntentId: RELEASE_INTENT_ID, main: SUCCEEDED_MAIN, develop: SUCCEEDED_DEVELOP, rounds: 1 };

    // Act
    const code = exitCodeForReleaseCiControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns 0 when both targets idempotently converge as already recorded", () => {
    // Arrange
    const outcome = { releaseIntentId: RELEASE_INTENT_ID, main: ALREADY_RECORDED_MAIN, develop: FAILED_ALREADY_RECORDED_DEVELOP, rounds: 1 };

    // Act
    const code = exitCodeForReleaseCiControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns 0 when a target's durable terminal result is a genuine CI failure (correctly observed and persisted, not a controller failure)", () => {
    // Arrange
    const outcome = { releaseIntentId: RELEASE_INTENT_ID, main: FAILED_MAIN, develop: SUCCEEDED_DEVELOP, rounds: 1 };

    // Act
    const code = exitCodeForReleaseCiControllerOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns a non-zero code when only one target reached a durable terminal result", () => {
    // Arrange
    const outcome = {
      releaseIntentId: RELEASE_INTENT_ID,
      main: SUCCEEDED_MAIN,
      develop: { outcome: "release_ci_exhausted" as const, releaseIntentId: RELEASE_INTENT_ID, target: "develop" as const, rounds: 55 },
    };

    // Act
    const code = exitCodeForReleaseCiControllerOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });

  it("returns a non-zero code when neither target reached a durable terminal result", () => {
    // Arrange
    const outcome = {
      releaseIntentId: RELEASE_INTENT_ID,
      main: { outcome: "ci_unbound" as const, releaseIntentId: RELEASE_INTENT_ID, target: "main" as const, number: 101, rounds: 1 },
      develop: { outcome: "release_ci_result_conflict" as const, releaseIntentId: RELEASE_INTENT_ID, target: "develop" as const, rounds: 1 },
    };

    // Act
    const code = exitCodeForReleaseCiControllerOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });
});
