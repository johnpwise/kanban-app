import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { launchExecutionRun } from "./launchExecutionRun";

import type { LaunchAdaExecutorJob } from "./launchExecutionRun";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

/**
 * Proves `launchExecutionRun` correctly reads and validates a *real* Firestore document (real
 * `Timestamp` instances, real field shapes) rather than going through the full Functions-emulator
 * event-dispatch path. Going through that path here would run the real, Cloud-Run-calling
 * launcher in-process on a genuine Firestore write (only avoided for the *deployed* trigger via
 * the `FUNCTIONS_EMULATOR` guard in index.ts) — this test uses an injected fake instead, so it
 * never touches the real Cloud Run Admin API regardless of how it is invoked.
 */
describeWithEmulator("launchExecutionRun (Firestore emulator)", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `functions-launch-integration-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(() => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  afterAll(async () => {
    await firestore.recursiveDelete(firestore.collection("executionRuns"));
    await deleteApp(app);
  });

  it("launches exactly once for a real, freshly written accepted execution run document", async () => {
    const executionRequestId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set({
      executionRequestId,
      correlationId: executionRequestId,
      projectId: "project-1",
      cardId: "card-1",
      status: "accepted",
      acceptedAt: Timestamp.now(),
      input: {
        title: "Ship the demo",
        prompt: "Ship the demo build.",
        repository: "johnpwise/kanban-app",
        baseBranch: "develop",
        requestedBy: "user-1",
        requestedAt: "2026-09-20T00:00:00.000Z",
        schemaVersion: 1,
        eventType: "ada.execution.requested",
      },
    });

    const snapshot = await docRef.get();
    const launchJob: LaunchAdaExecutorJob = vi.fn().mockResolvedValue({ operationName: "op-integration-1" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchExecutionRun({
      documentId: snapshot.id,
      data: snapshot.data(),
      eventId: "integration-event-1",
      launchJob,
      logger,
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ executionRequestId });

    const afterSnapshot = await docRef.get();
    expect(afterSnapshot.data()).toEqual(snapshot.data());
  });
});
