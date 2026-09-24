import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { launchDeliveryCiControl } from "./launchDeliveryCiControl";

import type { LaunchAdaCiControllerJob } from "./launchDeliveryCiControl";

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
 * Proves `launchDeliveryCiControl` correctly reads real Firestore before/after snapshots (real
 * `Timestamp` instances, real field shapes) rather than going through the full Functions-emulator
 * event-dispatch path — mirrors `launchExecutionRun.integration.test.ts`'s rationale. Uses an
 * injected fake `launchJob`, so it never touches the real Cloud Run Admin API.
 */
describeWithEmulator("launchDeliveryCiControl (Firestore emulator)", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `functions-launch-ci-control-integration-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(() => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  afterAll(async () => {
    await firestore.recursiveDelete(firestore.collection("executionRuns"));
    await deleteApp(app);
  });

  it("launches exactly once for a real delivery absent-to-present transition", async () => {
    const executionRequestId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(acceptedRunData(executionRequestId));
    const beforeSnapshot = await docRef.get();

    await docRef.update({
      delivery: {
        branch: `ada/${executionRequestId}`,
        commitSha: "a".repeat(40),
        recordedAt: Timestamp.now(),
      },
    });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaCiControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-1" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchDeliveryCiControl({
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

  it("does not launch a second time for a real duplicate delivery write (idempotent transition detection)", async () => {
    const executionRequestId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    const deliveryFields = {
      delivery: {
        branch: `ada/${executionRequestId}`,
        commitSha: "a".repeat(40),
        recordedAt: Timestamp.now(),
      },
    };
    await docRef.set(acceptedRunData(executionRequestId, deliveryFields));
    const beforeSnapshot = await docRef.get();

    // Simulate a retried/duplicate Firestore update event on an already-delivered run: the field
    // is rewritten (same shape), but delivery was already present beforehand.
    await docRef.update(deliveryFields);
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaCiControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-2" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchDeliveryCiControl({
      documentId: afterSnapshot.id,
      before: beforeSnapshot.data(),
      after: afterSnapshot.data(),
      eventId: "integration-event-2",
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch for a real unrelated update on an already-delivered run", async () => {
    const executionRequestId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRequestId);
    await docRef.set(
      acceptedRunData(executionRequestId, {
        delivery: {
          branch: `ada/${executionRequestId}`,
          commitSha: "a".repeat(40),
          recordedAt: Timestamp.now(),
        },
      }),
    );
    const beforeSnapshot = await docRef.get();

    await docRef.update({
      ci: {
        commitSha: "a".repeat(40),
        state: "succeeded",
        runId: 1,
        htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/1",
        recordedAt: Timestamp.now(),
      },
    });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaCiControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-3" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchDeliveryCiControl({
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
