import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { launchReleaseStart } from "./launchReleaseStart";

import type { LaunchAdaReleaseControllerJob } from "./launchReleaseStart";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

const TRUSTED_REPOSITORY = "johnpwise/kanban-app";

/**
 * Same rationale as `launchExecutionRun.integration.test.ts`: proves `launchReleaseStart` reads
 * and validates a real Firestore document (real `Timestamp` instances, real field shapes) using an
 * injected fake `launchJob`, so this never touches the real Cloud Run Admin API regardless of how
 * it is invoked.
 */
describeWithEmulator("launchReleaseStart (Firestore emulator)", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `functions-launch-release-integration-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(() => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  afterAll(async () => {
    await firestore.recursiveDelete(firestore.collection("releaseRequests"));
    await deleteApp(app);
  });

  it("launches exactly once for a real, freshly written release request document", async () => {
    const releaseRequestId = `release-request-${randomUUID()}`;
    const docRef = firestore.collection("releaseRequests").doc(releaseRequestId);
    await docRef.set({
      releaseRequestId,
      version: "0.2.0",
      requestedBy: "user-1",
      requestedAt: Timestamp.now(),
    });

    const snapshot = await docRef.get();
    const launchJob: LaunchAdaReleaseControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-1" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchReleaseStart({
      documentId: snapshot.id,
      data: snapshot.data(),
      eventId: "integration-event-1",
      trustedRepository: TRUSTED_REPOSITORY,
      launchJob,
      logger,
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ releaseIntentId: "johnpwise__kanban-app--0.2.0" });

    const afterSnapshot = await docRef.get();
    expect(afterSnapshot.data()).toEqual(snapshot.data());
  });
});
