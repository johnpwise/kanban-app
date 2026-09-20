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
    expect(outcome).toEqual({ ok: true });
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

  it("leaves the execution run document byte-for-byte unchanged after a successful run", async () => {
    // Arrange
    const executionRequestId = `req-${randomUUID()}`;
    const runData = acceptedRunData({ executionRequestId, projectId: "project-1", cardId: "card-1" });
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(runData);

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: executionRequestId },
      repository: createFirestoreExecutionRunRepository(),
      logger: silentLogger,
    });

    // Assert
    const snapshot = await docRef.get();
    expect(snapshot.data()).toEqual(runData);
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
    expect(outcome).toEqual({ ok: true });
    const cardSnapshot = await cardRef.get();
    expect(cardSnapshot.data()).toEqual(cardFixture);
    expect(cardSnapshot.data()?.executionStatus).toBe("queued");

    await cardRef.delete();
  });
});
