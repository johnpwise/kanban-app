import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFirestoreExecutionRunRepository } from "./executionRunRepository";
import { runExecutor } from "./runExecutor";

import type { ExecutorLogger } from "./runExecutor";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

const silentLogger: ExecutorLogger = {
  info: () => undefined,
  error: () => undefined,
};

function acceptedRunData(overrides: { executionRequestId: string; projectId: string; cardId: string }) {
  return {
    executionRequestId: overrides.executionRequestId,
    correlationId: overrides.executionRequestId,
    projectId: overrides.projectId,
    cardId: overrides.cardId,
    status: "accepted" as const,
    acceptedAt: Timestamp.now(),
    firstMessageId: "msg-1",
    input: {
      schemaVersion: 1 as const,
      eventType: "ada.execution.requested" as const,
      title: "Ship the demo",
      prompt: "Ship the demo build.",
      repository: "johnpwise/kanban-app",
      baseBranch: "develop",
      requestedBy: "user-1",
      requestedAt: "2026-09-20T00:00:00.000Z",
    },
  };
}

describeWithEmulator("executor against the Firestore emulator", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `executor-integration-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(() => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it("loads and validates a real seeded accepted execution run", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    await firestore.collection("executionRuns").doc(executionRequestId).set(runData);

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true });
  });

  it("fails clearly for a missing document", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("fails validation for a malformed document", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    await firestore.collection("executionRuns").doc(executionRequestId).set({ not: "a valid run" });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("leaves the immutable input unchanged and records a claim marker after a winning run", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(runData);

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
      claimIdFactory: () => "claim-1",
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true });
    const data = (await docRef.get()).data();
    expect(data?.input).toEqual(runData.input);
    expect(data?.status).toBe("accepted");
    expect(data?.claim).toMatchObject({ claimId: "claim-1" });
    expect(data?.claim?.claimedAt).toBeInstanceOf(Timestamp);
  });

  it("given two concurrent executor attempts for the same run, exactly one wins the claim", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(runData);

    // Act
    const [outcomeA, outcomeB] = await Promise.all([
      runExecutor({
        env: { ADA_EXECUTION_RUN_ID: executionRequestId },
        repository: createFirestoreExecutionRunRepository(),
        logger: silentLogger,
        claimIdFactory: () => "attempt-A",
      }),
      runExecutor({
        env: { ADA_EXECUTION_RUN_ID: executionRequestId },
        repository: createFirestoreExecutionRunRepository(),
        logger: silentLogger,
        claimIdFactory: () => "attempt-B",
      }),
    ]);

    // Assert
    const outcomes = [outcomeA, outcomeB];
    expect(outcomes.filter((outcome) => outcome.ok && outcome.claimed)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.ok && !outcome.claimed)).toHaveLength(1);

    const winningClaimId = outcomeA.ok && outcomeA.claimed ? "attempt-A" : "attempt-B";
    const data = (await docRef.get()).data();
    expect(data?.claim).toMatchObject({ claimId: winningClaimId });
    expect(data?.input).toEqual(runData.input);
  });

  it("a duplicate executor observing an existing claim performs no writes and does not touch the Card", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const cardProjectId = `project-${randomUUID()}`;
    const cardId = `card-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: cardProjectId, cardId });
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(runData);
    const repository = createFirestoreExecutionRunRepository();
    await repository.claimExecutionRun(executionRequestId, "first-claim");
    const claimedSnapshotBefore = (await docRef.get()).data();

    const cardRef = firestore.doc(`projects/${cardProjectId}/cards/${cardId}`);
    const cardFixture = { title: "Ship the demo", executionStatus: "queued", updatedAt: Timestamp.now() };
    await cardRef.set(cardFixture);

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository,
      logger: silentLogger,
      claimIdFactory: () => "second-claim",
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: false });
    const data = (await docRef.get()).data();
    expect(data).toEqual(claimedSnapshotBefore);
    expect(data?.claim).toMatchObject({ claimId: "first-claim" });
    const cardSnapshot = await cardRef.get();
    expect(cardSnapshot.data()).toEqual(cardFixture);

    await cardRef.delete();
  });

  it("leaves the related Card unchanged and queued after a successful run", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const cardProjectId = `project-${randomUUID()}`;
    const cardId = `card-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: cardProjectId, cardId });
    await firestore.collection("executionRuns").doc(executionRequestId).set(runData);

    const cardRef = firestore.doc(`projects/${cardProjectId}/cards/${cardId}`);
    const cardFixture = {
      title: "Ship the demo",
      executionStatus: "queued",
      updatedAt: Timestamp.now(),
    };
    await cardRef.set(cardFixture);

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true });
    const cardSnapshot = await cardRef.get();
    expect(cardSnapshot.data()).toEqual(cardFixture);
    expect(cardSnapshot.data()?.executionStatus).toBe("queued");

    await cardRef.delete();
  });
});
