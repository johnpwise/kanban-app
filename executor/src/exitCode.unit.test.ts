import { describe, expect, it } from "vitest";

import { exitCodeForCiControllerOutcome, exitCodeForMergeControllerOutcome, exitCodeForOutcome } from "./exitCode";

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
