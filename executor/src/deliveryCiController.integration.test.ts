import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runDeliveryCiController } from "./deliveryCiController";
import { createFirestoreExecutionRunRepository } from "./executionRunRepository";

import type { ObserveDeliveryCiStatus, ObserveDeliveryCiStatusOutcome, ObserveDeliveryCiStatusRequest } from "./deliveryCiObservation";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

const REPOSITORY = "johnpwise/kanban-app";
const DELIVERY_COMMIT_SHA = "a".repeat(40);

/** No live GitHub call — same rule `main.integration.test.ts` applies to automated tests. This
 * proves the controller's real-Firestore loader wiring, not the (already unit-tested) observer. */
function createFakeObserve(outcome: ObserveDeliveryCiStatusOutcome) {
  const calls: ObserveDeliveryCiStatusRequest[] = [];
  const observe: ObserveDeliveryCiStatus = async (request) => {
    calls.push(request);
    return outcome;
  };
  return { observe, calls };
}

async function neverWaits(): Promise<void> {
  throw new Error("wait() should not be called in these fixtures — every observation here is terminal on the first call.");
}

describeWithEmulator("runDeliveryCiController against the Firestore emulator", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `executor-ci-controller-integration-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(() => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it("loads a real persisted execution run and observes using its exact delivery identity", async () => {
    // Arrange
    const executionRunId = `req-${randomUUID()}`;
    await firestore
      .collection("executionRuns")
      .doc(executionRunId)
      .set({
        executionRequestId: executionRunId,
        correlationId: "corr-1",
        projectId: "project-1",
        cardId: "card-1",
        status: "accepted",
        acceptedAt: Timestamp.now(),
        input: {
          schemaVersion: 1,
          eventType: "ada.execution.requested",
          title: "Integration fixture",
          prompt: "Integration fixture prompt",
          repository: REPOSITORY,
          baseBranch: "develop",
          requestedBy: "user-1",
          requestedAt: "2026-09-20T00:00:00.000Z",
        },
        delivery: {
          branch: `ada/delivery-${executionRunId}`,
          commitSha: DELIVERY_COMMIT_SHA,
          recordedAt: Timestamp.now(),
        },
      });
    const repository = createFirestoreExecutionRunRepository();
    const { observe, calls } = createFakeObserve({
      ok: true,
      state: "succeeded",
      runId: 1,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/1",
    });

    // Act
    const outcome = await runDeliveryCiController({
      executionRunId,
      repository,
      observe,
      wait: neverWaits,
      policy: { maxObservations: 3, delayMs: 1_000 },
    });

    // Assert
    expect(outcome).toEqual({
      outcome: "ci_succeeded",
      runId: 1,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/1",
      observationCount: 1,
    });
    expect(calls).toEqual([{ repository: REPOSITORY, deliveryCommitSha: DELIVERY_COMMIT_SHA }]);
    const data = (await firestore.collection("executionRuns").doc(executionRunId).get()).data();
    expect(data?.status).toBe("ci_succeeded");
    expect(data?.ci?.commitSha).toBe(DELIVERY_COMMIT_SHA);
    expect(data?.ci?.state).toBe("succeeded");
    expect(data?.ci?.runId).toBe(1);
    expect(data?.ci?.recordedAt).toBeInstanceOf(Timestamp);
  });

  it("returns delivery_missing for a real persisted execution run that has not recorded a delivery yet", async () => {
    // Arrange
    const executionRunId = `req-${randomUUID()}`;
    await firestore
      .collection("executionRuns")
      .doc(executionRunId)
      .set({
        executionRequestId: executionRunId,
        correlationId: "corr-1",
        projectId: "project-1",
        cardId: "card-1",
        status: "accepted",
        acceptedAt: Timestamp.now(),
        input: {
          schemaVersion: 1,
          eventType: "ada.execution.requested",
          title: "Integration fixture",
          prompt: "Integration fixture prompt",
          repository: REPOSITORY,
          baseBranch: "develop",
          requestedBy: "user-1",
          requestedAt: "2026-09-20T00:00:00.000Z",
        },
      });
    const repository = createFirestoreExecutionRunRepository();
    const { observe, calls } = createFakeObserve({ ok: true, state: "pending" });

    // Act
    const outcome = await runDeliveryCiController({
      executionRunId,
      repository,
      observe,
      wait: neverWaits,
      policy: { maxObservations: 3, delayMs: 1_000 },
    });

    // Assert
    expect(outcome).toEqual({ outcome: "delivery_missing" });
    expect(calls).toHaveLength(0);
  });

  it("returns execution_run_not_found for an execution run id with no document in Firestore", async () => {
    // Arrange
    const executionRunId = `req-${randomUUID()}`;
    const repository = createFirestoreExecutionRunRepository();
    const { observe, calls } = createFakeObserve({ ok: true, state: "pending" });

    // Act
    const outcome = await runDeliveryCiController({
      executionRunId,
      repository,
      observe,
      wait: neverWaits,
      policy: { maxObservations: 3, delayMs: 1_000 },
    });

    // Assert
    expect(outcome).toEqual({ outcome: "execution_run_not_found" });
    expect(calls).toHaveLength(0);
  });
});
