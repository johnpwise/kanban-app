import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { launchReleaseCiControl } from "./launchReleaseCiControl";

import type { LaunchAdaReleaseCiControllerJob } from "./launchReleaseCiControl";

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

function pullRequestResult(overrides: Record<string, unknown> = {}) {
  return {
    number: 64,
    baseBranch: "main",
    headBranch: "release/0.2.0",
    headSha: "a".repeat(40),
    recordedAt: Timestamp.now(),
    ...overrides,
  };
}

/**
 * Proves `launchReleaseCiControl` correctly reads real Firestore before/after snapshots (real
 * `Timestamp` instances, real field shapes) rather than going through the full Functions-emulator
 * event-dispatch path — mirrors `launchReleasePullRequestControl.integration.test.ts`'s own
 * rationale. Uses an injected fake `launchJob`, so it never touches the real Cloud Run Admin API.
 */
describeWithEmulator("launchReleaseCiControl (Firestore emulator)", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `functions-launch-release-ci-control-integration-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(() => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  afterAll(async () => {
    await firestore.recursiveDelete(firestore.collection("releaseIntents"));
    await deleteApp(app);
  });

  it("launches exactly once for a real pullRequests.main-recorded transition", async () => {
    const releaseIntentId = `intent-${randomUUID()}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    await docRef.set(releaseIntentData(releaseIntentId));
    const beforeSnapshot = await docRef.get();

    await docRef.update({ pullRequests: { main: pullRequestResult() } });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaReleaseCiControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-1" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchReleaseCiControl({
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

  it("launches a second time for a real pullRequests.develop-recorded transition on an already-main-recorded intent", async () => {
    const releaseIntentId = `intent-${randomUUID()}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    await docRef.set(releaseIntentData(releaseIntentId, { pullRequests: { main: pullRequestResult() } }));
    const beforeSnapshot = await docRef.get();

    await docRef.update({ "pullRequests.develop": pullRequestResult({ baseBranch: "develop" }) });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaReleaseCiControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-2" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchReleaseCiControl({
      documentId: afterSnapshot.id,
      before: beforeSnapshot.data(),
      after: afterSnapshot.data(),
      eventId: "integration-event-2",
      launchJob,
      logger,
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ releaseIntentId });
  });

  it("does not launch a second time for a real ci-persistence update on an already-recorded target", async () => {
    const releaseIntentId = `intent-${randomUUID()}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    await docRef.set(releaseIntentData(releaseIntentId, { pullRequests: { main: pullRequestResult() } }));
    const beforeSnapshot = await docRef.get();

    // Simulate the release-ci-controller's own durable persistence of a verified CI result.
    await docRef.update({
      ci: {
        main: {
          ...pullRequestResult(),
          state: "succeeded",
          runId: 123,
          htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/123",
        },
      },
    });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaReleaseCiControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-3" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchReleaseCiControl({
      documentId: afterSnapshot.id,
      before: beforeSnapshot.data(),
      after: afterSnapshot.data(),
      eventId: "integration-event-3",
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch for a real unrelated field update while both targets remain absent", async () => {
    const releaseIntentId = `intent-${randomUUID()}`;
    const docRef = firestore.collection("releaseIntents").doc(releaseIntentId);
    await docRef.set(releaseIntentData(releaseIntentId));
    const beforeSnapshot = await docRef.get();

    await docRef.update({ requestedAt: Timestamp.now() });
    const afterSnapshot = await docRef.get();

    const launchJob: LaunchAdaReleaseCiControllerJob = vi.fn().mockResolvedValue({ operationName: "op-integration-4" });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await launchReleaseCiControl({
      documentId: afterSnapshot.id,
      before: beforeSnapshot.data(),
      after: afterSnapshot.data(),
      eventId: "integration-event-4",
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
  });
});
