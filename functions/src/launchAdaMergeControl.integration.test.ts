import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { launchAdaMergeControl } from "./launchAdaMergeControl";

import type { LaunchAdaMergeControllerJob } from "./launchAdaMergeControl";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

function acceptedRunData(executionRequestId: string, overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

/**
 * Proves `launchAdaMergeControl` correctly reads real Firestore before/after snapshots (real
 * `Timestamp` instances, real field shapes) rather than going through the full Functions-emulator
 * event-dispatch path — mirrors `launchDeliveryCiControl.integration.test.ts`'s rationale. Uses an
 * injected fake `launchJob`, so it never touches the real Cloud Run Admin API.
 */
describeWithEmulator("launchAdaMergeControl (Firestore emulator)", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `functions-launch-merge-control-integration-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(() => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  afterAll(async () => {
    await firestore.recursiveDelete(firestore.collection("executionRuns"));
    await deleteApp(app);
  });

  it("launches exactly once for a real ci_succeeded transition", async () => {
    const executionRequestId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(
      acceptedRunData(executionRequestId, {
        delivery: { branch: `ada/${executionRequestId}`, commitSha: "a".repeat(40), recordedAt: Timestamp.now() },
      }),
    );
    const beforeSnapshot = await docRef.get();

    await docRef.update({
      status: "ci_succeeded",
      ci: {
        commitSha: "a".repeat(40),
        state: "succeeded",
        runId: 1,
        htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/1",
        recordedAt: Timestamp.now(),
      },
    });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaMergeControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-1" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchAdaMergeControl({
      documentId: afterSnapshot.id,
      before: beforeSnapshot.data(),
      after: afterSnapshot.data(),
      eventId: "integration-event-1",
      launchJob,
      logger,
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ executionRequestId });
  });

  it("does not launch for a real transition into ci_failed", async () => {
    const executionRequestId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(
      acceptedRunData(executionRequestId, {
        delivery: { branch: `ada/${executionRequestId}`, commitSha: "a".repeat(40), recordedAt: Timestamp.now() },
      }),
    );
    const beforeSnapshot = await docRef.get();

    await docRef.update({
      status: "ci_failed",
      ci: {
        commitSha: "a".repeat(40),
        state: "failed",
        runId: 1,
        htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/1",
        conclusion: "failure",
        recordedAt: Timestamp.now(),
      },
    });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaMergeControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-2" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchAdaMergeControl({
      documentId: afterSnapshot.id,
      before: beforeSnapshot.data(),
      after: afterSnapshot.data(),
      eventId: "integration-event-2",
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch a second time for a real unrelated update on an already-ci_succeeded run", async () => {
    const executionRequestId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(
      acceptedRunData(executionRequestId, {
        status: "ci_succeeded",
        delivery: { branch: `ada/${executionRequestId}`, commitSha: "a".repeat(40), recordedAt: Timestamp.now() },
        ci: {
          commitSha: "a".repeat(40),
          state: "succeeded",
          runId: 1,
          htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/1",
          recordedAt: Timestamp.now(),
        },
      }),
    );
    const beforeSnapshot = await docRef.get();

    // Simulate a retried/duplicate Firestore update event on an already-ci_succeeded run.
    await docRef.update({ status: "ci_succeeded" });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaMergeControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-3" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchAdaMergeControl({
      documentId: afterSnapshot.id,
      before: beforeSnapshot.data(),
      after: afterSnapshot.data(),
      eventId: "integration-event-3",
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
  });
});
