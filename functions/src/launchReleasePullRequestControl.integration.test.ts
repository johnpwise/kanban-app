import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { launchReleasePullRequestControl } from "./launchReleasePullRequestControl";

import type { LaunchAdaReleasePullRequestControllerJob } from "./launchReleasePullRequestControl";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

function releaseIntentData(releaseIntentId: string, overrides: Record<string, unknown> = {}) {
  return {
    releaseIntentId,
    repository: "johnpwise/kanban-app",
    version: "0.2.0",
    sourceBranch: "develop",
    sourceRevision: "b".repeat(40),
    requestedAt: Timestamp.now(),
    ...overrides,
  };
}

function startResult(overrides: Record<string, unknown> = {}) {
  return {
    releaseBranch: "release/0.2.0",
    commitSha: "a".repeat(40),
    recordedAt: Timestamp.now(),
    ...overrides,
  };
}

/**
 * Proves `launchReleasePullRequestControl` correctly reads real Firestore before/after snapshots
 * (real `Timestamp` instances, real field shapes) rather than going through the full
 * Functions-emulator event-dispatch path — mirrors `launchAdaMergeControl.integration.test.ts`'s
 * own rationale. Uses an injected fake `launchJob`, so it never touches the real Cloud Run Admin
 * API.
 */
describeWithEmulator("launchReleasePullRequestControl (Firestore emulator)", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `functions-launch-release-pr-control-integration-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(() => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  afterAll(async () => {
    await firestore.recursiveDelete(firestore.collection("releaseIntents"));
    await deleteApp(app);
  });

  it("launches exactly once for a real start-completion transition", async () => {
    const releaseIntentId = `intent-${randomUUID()}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    await docRef.set(releaseIntentData(releaseIntentId));
    const beforeSnapshot = await docRef.get();

    await docRef.update({ start: startResult() });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaReleasePullRequestControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-1" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchReleasePullRequestControl({
      documentId: afterSnapshot.id,
      before: beforeSnapshot.data(),
      after: afterSnapshot.data(),
      eventId: "integration-event-1",
      launchJob,
      logger,
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ releaseIntentId });
  });

  it("does not launch a second time for a real pullRequests-persistence update on an already-started intent", async () => {
    const releaseIntentId = `intent-${randomUUID()}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    await docRef.set(releaseIntentData(releaseIntentId, { start: startResult() }));
    const beforeSnapshot = await docRef.get();

    // Simulate the release-pull-request-controller's own durable persistence of a verified PR.
    await docRef.update({
      pullRequests: {
        main: {
          number: 42,
          baseBranch: "main",
          headBranch: "release/0.2.0",
          headSha: "a".repeat(40),
          recordedAt: Timestamp.now(),
        },
      },
    });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaReleasePullRequestControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-2" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchReleasePullRequestControl({
      documentId: afterSnapshot.id,
      before: beforeSnapshot.data(),
      after: afterSnapshot.data(),
      eventId: "integration-event-2",
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch for a real unrelated field update while start remains absent", async () => {
    const releaseIntentId = `intent-${randomUUID()}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    await docRef.set(releaseIntentData(releaseIntentId));
    const beforeSnapshot = await docRef.get();

    // No genuine field to mutate pre-start other than re-writing an existing one; simulate a
    // redelivered/duplicate write that carries no start transition.
    await docRef.update({ requestedAt: Timestamp.now() });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaReleasePullRequestControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-3" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchReleasePullRequestControl({
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
