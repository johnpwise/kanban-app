import { describe, expect, it } from "vitest";

import { runMergeCompletionControllerWithRetry } from "./mergeCompletionRetryController";

import type { RunMergeCompletionControllerForRun } from "./mergeCompletionRetryController";
import type { MergeCompletionControllerOutcome } from "./mergeCompletionController";

const EXECUTION_RUN_ID = "req-123";
const REPOSITORY = "johnpwise/kanban-app";
const PULL_REQUEST_NUMBER = 42;
const DELIVERY_COMMIT_SHA = "a".repeat(40);
const MERGE_COMMIT_SHA = "c".repeat(40);

const DEFAULT_POLICY = { maxAttempts: 5, delayMs: 1_000 };

/** Throws if called more times than outcomes supplied — proof the retry loop is bounded. */
function createFakeRunMergeCompletionController(outcomes: MergeCompletionControllerOutcome[]) {
  const calls: string[] = [];
  const runMergeCompletionController: RunMergeCompletionControllerForRun = async (executionRunId) => {
    calls.push(executionRunId);
    if (calls.length > outcomes.length) {
      throw new Error(
        `runMergeCompletionController() called ${calls.length} times but the test only provided ${outcomes.length} outcome(s) — the retry loop is not bounded as expected.`,
      );
    }
    return outcomes[calls.length - 1];
  };
  return { runMergeCompletionController, calls };
}

function createFakeWait() {
  const calls: number[] = [];
  const wait = async (delayMs: number) => {
    calls.push(delayMs);
  };
  return { wait, calls };
}

const mergeabilityPendingOutcome: MergeCompletionControllerOutcome = {
  outcome: "not_eligible",
  executionRunId: EXECUTION_RUN_ID,
  eligibility: { eligible: false, reason: "mergeability_pending" },
};

const mergedOutcome: MergeCompletionControllerOutcome = {
  outcome: "merged",
  executionRunId: EXECUTION_RUN_ID,
  repository: REPOSITORY,
  pullRequestNumber: PULL_REQUEST_NUMBER,
  deliveryCommitSha: DELIVERY_COMMIT_SHA,
  mergeCommitSha: MERGE_COMMIT_SHA,
};

describe("runMergeCompletionControllerWithRetry", () => {
  it("returns immediately on a first-attempt success (merged) — no retry, no wait", async () => {
    const { runMergeCompletionController, calls } = createFakeRunMergeCompletionController([mergedOutcome]);
    const { wait, calls: waitCalls } = createFakeWait();

    const outcome = await runMergeCompletionControllerWithRetry({
      executionRunId: EXECUTION_RUN_ID,
      runMergeCompletionController,
      wait,
      policy: DEFAULT_POLICY,
    });

    expect(outcome).toEqual(mergedOutcome);
    expect(calls).toEqual([EXECUTION_RUN_ID]);
    expect(waitCalls).toEqual([]);
  });

  it("returns immediately on a first-attempt already_merged — no retry", async () => {
    const alreadyMerged: MergeCompletionControllerOutcome = {
      outcome: "merge_already_recorded",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
      deliveryCommitSha: DELIVERY_COMMIT_SHA,
      mergeCommitSha: MERGE_COMMIT_SHA,
    };
    const { runMergeCompletionController, calls } = createFakeRunMergeCompletionController([alreadyMerged]);
    const { wait } = createFakeWait();

    const outcome = await runMergeCompletionControllerWithRetry({
      executionRunId: EXECUTION_RUN_ID,
      runMergeCompletionController,
      wait,
      policy: DEFAULT_POLICY,
    });

    expect(outcome).toEqual(alreadyMerged);
    expect(calls).toHaveLength(1);
  });

  it("returns immediately on a not_eligible reason other than mergeability_pending — no retry", async () => {
    const notMergeable: MergeCompletionControllerOutcome = {
      outcome: "not_eligible",
      executionRunId: EXECUTION_RUN_ID,
      eligibility: { eligible: false, reason: "not_mergeable" },
    };
    const { runMergeCompletionController, calls } = createFakeRunMergeCompletionController([notMergeable]);
    const { wait, calls: waitCalls } = createFakeWait();

    const outcome = await runMergeCompletionControllerWithRetry({
      executionRunId: EXECUTION_RUN_ID,
      runMergeCompletionController,
      wait,
      policy: DEFAULT_POLICY,
    });

    expect(outcome).toEqual(notMergeable);
    expect(calls).toHaveLength(1);
    expect(waitCalls).toEqual([]);
  });

  it("returns immediately on a merge failure outcome — no retry", async () => {
    const mergeFailed: MergeCompletionControllerOutcome = {
      outcome: "merge_permission_denied",
      executionRunId: EXECUTION_RUN_ID,
      repository: REPOSITORY,
      pullRequestNumber: PULL_REQUEST_NUMBER,
    };
    const { runMergeCompletionController, calls } = createFakeRunMergeCompletionController([mergeFailed]);
    const { wait } = createFakeWait();

    const outcome = await runMergeCompletionControllerWithRetry({
      executionRunId: EXECUTION_RUN_ID,
      runMergeCompletionController,
      wait,
      policy: DEFAULT_POLICY,
    });

    expect(outcome).toEqual(mergeFailed);
    expect(calls).toHaveLength(1);
  });

  it("retries only while the outcome is mergeability_pending, with a fresh eligibility check each attempt", async () => {
    const { runMergeCompletionController, calls } = createFakeRunMergeCompletionController([
      mergeabilityPendingOutcome,
      mergeabilityPendingOutcome,
      mergedOutcome,
    ]);
    const { wait, calls: waitCalls } = createFakeWait();

    const outcome = await runMergeCompletionControllerWithRetry({
      executionRunId: EXECUTION_RUN_ID,
      runMergeCompletionController,
      wait,
      policy: DEFAULT_POLICY,
    });

    expect(outcome).toEqual(mergedOutcome);
    expect(calls).toEqual([EXECUTION_RUN_ID, EXECUTION_RUN_ID, EXECUTION_RUN_ID]);
    expect(waitCalls).toEqual([1_000, 1_000]);
  });

  it("exhausts the bound and returns mergeability_retry_exhausted when every attempt stays pending, without exceeding maxAttempts calls", async () => {
    const { runMergeCompletionController, calls } = createFakeRunMergeCompletionController([
      mergeabilityPendingOutcome,
      mergeabilityPendingOutcome,
      mergeabilityPendingOutcome,
    ]);
    const { wait, calls: waitCalls } = createFakeWait();

    const outcome = await runMergeCompletionControllerWithRetry({
      executionRunId: EXECUTION_RUN_ID,
      runMergeCompletionController,
      wait,
      policy: { maxAttempts: 3, delayMs: 500 },
    });

    expect(outcome).toEqual({ outcome: "mergeability_retry_exhausted", executionRunId: EXECUTION_RUN_ID, attempts: 3 });
    expect(calls).toHaveLength(3);
    // Waits only between attempts, never after the last one.
    expect(waitCalls).toEqual([500, 500]);
  });

  it("never sleeps for real — the injected wait is the only source of delay", async () => {
    const { runMergeCompletionController } = createFakeRunMergeCompletionController([
      mergeabilityPendingOutcome,
      mergedOutcome,
    ]);
    const { wait } = createFakeWait();

    const start = Date.now();
    await runMergeCompletionControllerWithRetry({
      executionRunId: EXECUTION_RUN_ID,
      runMergeCompletionController,
      wait,
      policy: { maxAttempts: 5, delayMs: 60_000 },
    });
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});
