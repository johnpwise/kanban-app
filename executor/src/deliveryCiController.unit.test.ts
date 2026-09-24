import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { runDeliveryCiController } from "./deliveryCiController";
import { createFakeExecutionRunRepository } from "./testHelpers/fakeExecutionRunRepository";

import type { ObserveDeliveryCiStatus, ObserveDeliveryCiStatusOutcome, ObserveDeliveryCiStatusRequest } from "./deliveryCiObservation";

const EXECUTION_RUN_ID = "req-1";
const REPOSITORY = "johnpwise/kanban-app";
const DELIVERY_COMMIT_SHA = "a".repeat(40);
const SOURCE_REVISION_SHA = "c".repeat(40);
const HTML_URL = "https://github.com/johnpwise/kanban-app/actions/runs/501";

const DEFAULT_POLICY = { maxObservations: 5, delayMs: 1_000 };

function baseRunData(overrides: { delivery?: unknown; sourceRevision?: unknown } = {}) {
  return {
    executionRequestId: EXECUTION_RUN_ID,
    correlationId: "corr-1",
    projectId: "project-1",
    cardId: "card-1",
    status: "accepted",
    acceptedAt: Timestamp.now(),
    input: {
      schemaVersion: 1,
      eventType: "ada.execution.requested",
      title: "Some title",
      prompt: "Some prompt",
      repository: REPOSITORY,
      baseBranch: "develop",
      requestedBy: "user-1",
      requestedAt: "2026-09-20T00:00:00.000Z",
    },
    ...(overrides.sourceRevision ? { sourceRevision: overrides.sourceRevision } : {}),
    ...(overrides.delivery ? { delivery: overrides.delivery } : {}),
  };
}

function deliveredRunData(deliveryOverrides: Partial<{ branch: string; commitSha: string }> = {}) {
  return baseRunData({
    sourceRevision: { headSha: SOURCE_REVISION_SHA, resolvedAt: Timestamp.now() },
    delivery: {
      branch: "ada/delivery-req-1",
      commitSha: DELIVERY_COMMIT_SHA,
      recordedAt: Timestamp.now(),
      ...deliveryOverrides,
    },
  });
}

/** Throws if `observe` is called more times than the test supplied outcomes for — this is the
 * test-side proof that the controller's retry loop is bounded and never runs unbounded. */
function createFakeObserve(outcomes: ObserveDeliveryCiStatusOutcome[]) {
  const calls: ObserveDeliveryCiStatusRequest[] = [];
  const observe: ObserveDeliveryCiStatus = async (request) => {
    calls.push(request);
    if (calls.length > outcomes.length) {
      throw new Error(
        `observe() called ${calls.length} times but the test only provided ${outcomes.length} outcome(s) — the controller's retry loop is not bounded as expected.`,
      );
    }
    return outcomes[calls.length - 1];
  };
  return { observe, calls };
}

function createFakeWait() {
  const calls: number[] = [];
  const wait = async (delayMs: number) => {
    calls.push(delayMs);
  };
  return { wait, calls };
}

describe("runDeliveryCiController", () => {
  describe("missing or invalid durable delivery — fails safely before any observation", () => {
    it("returns execution_run_load_error and never observes when loading the execution run throws unexpectedly", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({ throwError: new Error("Firestore unavailable") });
      const { observe, calls: observeCalls } = createFakeObserve([]);
      const { wait } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: DEFAULT_POLICY,
      });

      // Assert
      expect(outcome).toEqual({ outcome: "execution_run_load_error" });
      expect(observeCalls).toHaveLength(0);
    });

    it("returns execution_run_not_found and never observes or waits when no such document exists", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({});
      const { observe, calls: observeCalls } = createFakeObserve([]);
      const { wait, calls: waitCalls } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: DEFAULT_POLICY,
      });

      // Assert
      expect(outcome).toEqual({ outcome: "execution_run_not_found" });
      expect(observeCalls).toHaveLength(0);
      expect(waitCalls).toHaveLength(0);
    });

    it("returns execution_run_invalid and never observes when the persisted document fails schema validation", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({ data: { not: "a valid execution run document" } });
      const { observe, calls: observeCalls } = createFakeObserve([]);
      const { wait } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: DEFAULT_POLICY,
      });

      // Assert
      expect(outcome).toEqual({ outcome: "execution_run_invalid" });
      expect(observeCalls).toHaveLength(0);
    });

    it("returns delivery_missing and never observes when the execution run is valid but has no persisted delivery", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({ data: baseRunData() });
      const { observe, calls: observeCalls } = createFakeObserve([]);
      const { wait } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: DEFAULT_POLICY,
      });

      // Assert
      expect(outcome).toEqual({ outcome: "delivery_missing" });
      expect(observeCalls).toHaveLength(0);
    });
  });

  describe("terminal on first observation", () => {
    it("returns ci_succeeded on the first observation, using the exact persisted repository and delivery commit sha, and never waits", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({ data: deliveredRunData() });
      const { observe, calls: observeCalls } = createFakeObserve([
        { ok: true, state: "succeeded", runId: 501, htmlUrl: HTML_URL },
      ]);
      const { wait, calls: waitCalls } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: DEFAULT_POLICY,
      });

      // Assert
      expect(outcome).toEqual({ outcome: "ci_succeeded", runId: 501, htmlUrl: HTML_URL, observationCount: 1 });
      expect(observeCalls).toEqual([{ repository: REPOSITORY, deliveryCommitSha: DELIVERY_COMMIT_SHA }]);
      expect(waitCalls).toHaveLength(0);
    });

    it("returns ci_failed on the first observation, without retrying", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({ data: deliveredRunData() });
      const { observe, calls: observeCalls } = createFakeObserve([
        { ok: true, state: "failed", runId: 502, htmlUrl: HTML_URL, conclusion: "failure" },
      ]);
      const { wait, calls: waitCalls } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: DEFAULT_POLICY,
      });

      // Assert
      expect(outcome).toEqual({
        outcome: "ci_failed",
        runId: 502,
        htmlUrl: HTML_URL,
        conclusion: "failure",
        observationCount: 1,
      });
      expect(observeCalls).toHaveLength(1);
      expect(waitCalls).toHaveLength(0);
    });

    it("observes using the persisted delivery commit sha, never the source revision head sha or delivery branch name", async () => {
      // Arrange — sourceRevision.headSha and delivery.branch are deliberately distinct values from
      // delivery.commitSha, so the assertion below fails if the controller ever substitutes either.
      const { repository } = createFakeExecutionRunRepository({ data: deliveredRunData() });
      const { observe, calls: observeCalls } = createFakeObserve([{ ok: true, state: "pending" }]);
      const { wait } = createFakeWait();

      // Act
      await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: { maxObservations: 1, delayMs: 1_000 },
      });

      // Assert
      expect(observeCalls).toEqual([{ repository: REPOSITORY, deliveryCommitSha: DELIVERY_COMMIT_SHA }]);
      expect(observeCalls[0].deliveryCommitSha).not.toBe(SOURCE_REVISION_SHA);
    });
  });

  describe("pending loop mechanics", () => {
    it("waits once between a pending observation and a succeeding second observation, and never waits again", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({ data: deliveredRunData() });
      const { observe, calls: observeCalls } = createFakeObserve([
        { ok: true, state: "pending" },
        { ok: true, state: "succeeded", runId: 9, htmlUrl: HTML_URL },
      ]);
      const { wait, calls: waitCalls } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: { maxObservations: 5, delayMs: 2_000 },
      });

      // Assert
      expect(outcome).toEqual({ outcome: "ci_succeeded", runId: 9, htmlUrl: HTML_URL, observationCount: 2 });
      expect(observeCalls).toHaveLength(2);
      expect(waitCalls).toEqual([2_000]);
    });

    it("returns exhausted after the configured bound of pending observations, waiting exactly bound-minus-one times, and never observes again", async () => {
      // Arrange
      const pendingOutcomes: ObserveDeliveryCiStatusOutcome[] = Array.from({ length: 4 }, () => ({
        ok: true,
        state: "pending",
      }));
      const { repository } = createFakeExecutionRunRepository({ data: deliveredRunData() });
      const { observe, calls: observeCalls } = createFakeObserve(pendingOutcomes);
      const { wait, calls: waitCalls } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: { maxObservations: 4, delayMs: 500 },
      });

      // Assert — createFakeObserve above throws if a 5th call is ever made, proving the loop is
      // bounded rather than merely happening to stop here.
      expect(outcome).toEqual({ outcome: "exhausted", observationCount: 4 });
      expect(observeCalls).toHaveLength(4);
      expect(waitCalls).toEqual([500, 500, 500]);
    });
  });

  describe("observation failure remains distinct from CI failure and is never retried", () => {
    it("returns observation_failed for credential_unavailable, passing the credential reason through, without waiting or retrying", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({ data: deliveredRunData() });
      const { observe, calls: observeCalls } = createFakeObserve([
        { ok: false, reason: "credential_unavailable", credentialReason: "config_invalid" },
      ]);
      const { wait, calls: waitCalls } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: DEFAULT_POLICY,
      });

      // Assert
      expect(outcome).toEqual({
        outcome: "observation_failed",
        reason: "credential_unavailable",
        credentialReason: "config_invalid",
        observationCount: 1,
      });
      expect(observeCalls).toHaveLength(1);
      expect(waitCalls).toHaveLength(0);
    });

    it("returns observation_failed for runs_lookup_failed, passing the safe http status through", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({ data: deliveredRunData() });
      const { observe } = createFakeObserve([{ ok: false, reason: "runs_lookup_failed", httpStatus: 500 }]);
      const { wait, calls: waitCalls } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: DEFAULT_POLICY,
      });

      // Assert
      expect(outcome).toEqual({
        outcome: "observation_failed",
        reason: "runs_lookup_failed",
        httpStatus: 500,
        observationCount: 1,
      });
      expect(waitCalls).toHaveLength(0);
    });

    it("returns observation_failed for runs_lookup_network_error", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({ data: deliveredRunData() });
      const { observe } = createFakeObserve([{ ok: false, reason: "runs_lookup_network_error" }]);
      const { wait, calls: waitCalls } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: DEFAULT_POLICY,
      });

      // Assert
      expect(outcome).toEqual({ outcome: "observation_failed", reason: "runs_lookup_network_error", observationCount: 1 });
      expect(waitCalls).toHaveLength(0);
    });

    it("returns observation_failed for malformed_response, never treating it as pending or as a CI failure", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({ data: deliveredRunData() });
      const { observe } = createFakeObserve([{ ok: false, reason: "malformed_response" }]);
      const { wait, calls: waitCalls } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: DEFAULT_POLICY,
      });

      // Assert
      expect(outcome).toEqual({ outcome: "observation_failed", reason: "malformed_response", observationCount: 1 });
      expect(outcome).not.toMatchObject({ outcome: "ci_failed" });
      expect(waitCalls).toHaveLength(0);
    });

    it("returns observation_error and stops immediately when observe() itself throws unexpectedly, never retrying", async () => {
      // Arrange — a throw violates observe()'s typed never-rejects contract; the controller must
      // still fail safely rather than propagating an unhandled rejection.
      const { repository } = createFakeExecutionRunRepository({ data: deliveredRunData() });
      const throwingObserve: ObserveDeliveryCiStatus = async () => {
        throw new Error("unexpected failure inside observe()");
      };
      const { wait, calls: waitCalls } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe: throwingObserve,
        wait,
        policy: DEFAULT_POLICY,
      });

      // Assert
      expect(outcome).toEqual({ outcome: "observation_error", observationCount: 1 });
      expect(waitCalls).toHaveLength(0);
    });

    it("terminates immediately on an observation failure that follows a prior pending observation, without waiting again or retrying", async () => {
      // Arrange
      const { repository } = createFakeExecutionRunRepository({ data: deliveredRunData() });
      const { observe, calls: observeCalls } = createFakeObserve([
        { ok: true, state: "pending" },
        { ok: false, reason: "runs_lookup_network_error" },
      ]);
      const { wait, calls: waitCalls } = createFakeWait();

      // Act
      const outcome = await runDeliveryCiController({
        executionRunId: EXECUTION_RUN_ID,
        repository,
        observe,
        wait,
        policy: { maxObservations: 5, delayMs: 750 },
      });

      // Assert
      expect(outcome).toEqual({ outcome: "observation_failed", reason: "runs_lookup_network_error", observationCount: 2 });
      expect(observeCalls).toHaveLength(2);
      expect(waitCalls).toEqual([750]);
    });
  });
});
