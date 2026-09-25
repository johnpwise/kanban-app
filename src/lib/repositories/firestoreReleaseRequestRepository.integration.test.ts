import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import { createReleaseRequest } from "./firestoreReleaseRequestRepository";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = emulatorHost ? describe : describe.skip;

describeWithEmulator("Firestore release request repository", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `release-request-repository-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(() => {
    expect(emulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
    expect(projectId).toMatch(/^demo-/);
  });

  afterAll(async () => {
    await firestore.recursiveDelete(firestore.collection("releaseRequests"));
    await deleteApp(app);
  });

  it("durably records a release request document whose id matches its own releaseRequestId field", async () => {
    // Act
    const result = await createReleaseRequest(firestore, { version: "0.2.0", requestedBy: "user-1" });

    // Assert
    const snapshot = await firestore.collection("releaseRequests").doc(result.releaseRequestId).get();
    expect(snapshot.exists).toBe(true);
    const data = snapshot.data();
    expect(data?.releaseRequestId).toBe(result.releaseRequestId);
    expect(data?.version).toBe("0.2.0");
    expect(data?.requestedBy).toBe("user-1");
    expect(data?.requestedAt).toBeDefined();
  });

  it("never trusts the caller for anything but version — requestedBy comes only from the verified input", async () => {
    // Act
    const result = await createReleaseRequest(firestore, { version: "1.4.2", requestedBy: "user-2" });

    // Assert
    const snapshot = await firestore.collection("releaseRequests").doc(result.releaseRequestId).get();
    expect(snapshot.data()?.requestedBy).toBe("user-2");
  });

  it("rejects an invalid version before writing anything", async () => {
    // Act / Assert
    await expect(
      createReleaseRequest(firestore, { version: "v0.2.0" as never, requestedBy: "user-1" }),
    ).rejects.toThrow();
  });
});
