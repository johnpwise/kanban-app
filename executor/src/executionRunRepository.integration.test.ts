import { randomUUID } from "node:crypto";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFirestoreExecutionRunRepository } from "./executionRunRepository";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

describeWithEmulator("createFirestoreExecutionRunRepository().claimExecutionRun against the Firestore emulator", () => {
  const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
  const app = initializeApp({ projectId }, `executor-claim-repository-integration-${randomUUID()}`);
  const firestore = getFirestore(app);

  beforeAll(() => {
    expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  afterAll(async () => {
    await deleteApp(app);
  });

  it("claims an unclaimed run and persists a durable claim marker", async () => {
    // Arrange
    const executionRunId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRunId);
    await docRef.set({ status: "accepted" });
    const repository = createFirestoreExecutionRunRepository();

    // Act
    const outcome = await repository.claimExecutionRun(executionRunId, "claim-1");

    // Assert
    expect(outcome).toEqual({ claimed: true });
    const data = (await docRef.get()).data();
    expect(data?.claim?.claimId).toBe("claim-1");
    expect(data?.claim?.claimedAt).toBeInstanceOf(Timestamp);
  });

  it("refuses a second claim once the run is already claimed", async () => {
    // Arrange
    const executionRunId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRunId);
    await docRef.set({ status: "accepted" });
    const repository = createFirestoreExecutionRunRepository();
    await repository.claimExecutionRun(executionRunId, "claim-1");

    // Act
    const outcome = await repository.claimExecutionRun(executionRunId, "claim-2");

    // Assert
    expect(outcome).toEqual({ claimed: false, reason: "already_claimed" });
    const data = (await docRef.get()).data();
    expect(data?.claim?.claimId).toBe("claim-1");
  });

  it("given many concurrent claim attempts for the same run, exactly one wins", async () => {
    // Arrange
    const executionRunId = `req-${randomUUID()}`;
    const docRef = firestore.collection("executionRuns").doc(executionRunId);
    await docRef.set({ status: "accepted" });
    const repository = createFirestoreExecutionRunRepository();
    const attemptCount = 5;
    const claimIds = Array.from({ length: attemptCount }, (_, index) => `attempt-${index}`);

    // Act
    const outcomes = await Promise.all(claimIds.map((claimId) => repository.claimExecutionRun(executionRunId, claimId)));

    // Assert
    expect(outcomes.filter((outcome) => outcome.claimed)).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.claimed)).toHaveLength(attemptCount - 1);

    const winningIndex = outcomes.findIndex((outcome) => outcome.claimed);
    const data = (await docRef.get()).data();
    expect(data?.claim?.claimId).toBe(claimIds[winningIndex]);
  });
});

describeWithEmulator(
  "createFirestoreExecutionRunRepository().recordSourceRevision against the Firestore emulator",
  () => {
    const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
    const app = initializeApp({ projectId }, `executor-source-revision-repository-integration-${randomUUID()}`);
    const firestore = getFirestore(app);
    const headSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

    beforeAll(() => {
      expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it("records the head SHA on a run with no existing source revision", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();

      // Act
      const outcome = await repository.recordSourceRevision(executionRunId, headSha);

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.sourceRevision?.headSha).toBe(headSha);
      expect(data?.sourceRevision?.resolvedAt).toBeInstanceOf(Timestamp);
    });

    it("idempotently accepts recording the same head SHA that is already persisted", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      await repository.recordSourceRevision(executionRunId, headSha);
      const firstResolvedAt = (await docRef.get()).data()?.sourceRevision?.resolvedAt;

      // Act
      const outcome = await repository.recordSourceRevision(executionRunId, headSha);

      // Assert
      expect(outcome).toEqual({ outcome: "already_recorded" });
      const data = (await docRef.get()).data();
      expect(data?.sourceRevision?.resolvedAt).toEqual(firstResolvedAt);
    });

    it("refuses to overwrite a conflicting already-persisted head SHA", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      await repository.recordSourceRevision(executionRunId, headSha);

      // Act
      const outcome = await repository.recordSourceRevision(executionRunId, "c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ff");

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.sourceRevision?.headSha).toBe(headSha);
    });

    it("given many concurrent recordings of the same head SHA, all succeed and only one write is persisted", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      const attemptCount = 5;

      // Act
      const outcomes = await Promise.all(
        Array.from({ length: attemptCount }, () => repository.recordSourceRevision(executionRunId, headSha)),
      );

      // Assert
      expect(outcomes.filter((outcome) => outcome.outcome === "created")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.outcome === "already_recorded")).toHaveLength(attemptCount - 1);
      const data = (await docRef.get()).data();
      expect(data?.sourceRevision?.headSha).toBe(headSha);
    });
  },
);

describeWithEmulator(
  "createFirestoreExecutionRunRepository().recordDelivery against the Firestore emulator",
  () => {
    const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
    const app = initializeApp({ projectId }, `executor-delivery-repository-integration-${randomUUID()}`);
    const firestore = getFirestore(app);
    const branch = "ada/req-1";
    const commitSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef";
    const otherCommitSha = "c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ff";

    beforeAll(() => {
      expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it("records the verified delivery on a run with no existing delivery", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();

      // Act
      const outcome = await repository.recordDelivery(executionRunId, { branch, commitSha });

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.delivery?.branch).toBe(branch);
      expect(data?.delivery?.commitSha).toBe(commitSha);
      expect(data?.delivery?.recordedAt).toBeInstanceOf(Timestamp);
      expect(data?.delivery?.pullRequest).toBeUndefined();
    });

    it("records the verified delivery together with a successful pull request identity", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      const pullRequest = { number: 42, htmlUrl: "https://github.com/johnpwise/kanban-app/pull/42" };

      // Act
      const outcome = await repository.recordDelivery(executionRunId, { branch, commitSha, pullRequest });

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.delivery?.pullRequest).toEqual(pullRequest);
    });

    it("idempotently accepts recording the exact same branch and commit SHA that is already persisted", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      await repository.recordDelivery(executionRunId, { branch, commitSha });
      const firstRecordedAt = (await docRef.get()).data()?.delivery?.recordedAt;

      // Act
      const outcome = await repository.recordDelivery(executionRunId, { branch, commitSha });

      // Assert
      expect(outcome).toEqual({ outcome: "already_recorded" });
      const data = (await docRef.get()).data();
      expect(data?.delivery?.recordedAt).toEqual(firstRecordedAt);
    });

    it("refuses to overwrite a conflicting already-persisted delivery branch", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      await repository.recordDelivery(executionRunId, { branch, commitSha });

      // Act
      const outcome = await repository.recordDelivery(executionRunId, { branch: "ada/req-2", commitSha });

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.delivery?.branch).toBe(branch);
    });

    it("refuses to overwrite a conflicting already-persisted delivery commit SHA", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      await repository.recordDelivery(executionRunId, { branch, commitSha });

      // Act
      const outcome = await repository.recordDelivery(executionRunId, { branch, commitSha: otherCommitSha });

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.delivery?.commitSha).toBe(commitSha);
    });

    it("treats a missing execution run at write time as a conflict and creates no delivery state", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      const repository = createFirestoreExecutionRunRepository();

      // Act
      const outcome = await repository.recordDelivery(executionRunId, { branch, commitSha });

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const snapshot = await docRef.get();
      expect(snapshot.exists).toBe(false);
    });

    it("given many concurrent recordings of the same delivery identity, exactly one create is persisted and the rest are idempotent", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      const attemptCount = 5;

      // Act
      const outcomes = await Promise.all(
        Array.from({ length: attemptCount }, () => repository.recordDelivery(executionRunId, { branch, commitSha })),
      );

      // Assert
      expect(outcomes.filter((outcome) => outcome.outcome === "created")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.outcome === "already_recorded")).toHaveLength(attemptCount - 1);
      const data = (await docRef.get()).data();
      expect(data?.delivery?.branch).toBe(branch);
      expect(data?.delivery?.commitSha).toBe(commitSha);
    });
  },
);

describeWithEmulator(
  "createFirestoreExecutionRunRepository().recordCiResult against the Firestore emulator",
  () => {
    const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
    const app = initializeApp({ projectId }, `executor-ci-result-repository-integration-${randomUUID()}`);
    const firestore = getFirestore(app);
    const commitSha = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefe";
    const otherCommitSha = "c0ffeec0ffeec0ffeec0ffeec0ffeec0ffeec0ffe";
    const succeeded = { commitSha, state: "succeeded" as const, runId: 1, htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/1" };
    const failed = { commitSha, state: "failed" as const, runId: 2, htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/2", conclusion: "failure" };

    beforeAll(() => {
      expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
    });

    afterAll(async () => {
      await deleteApp(app);
    });

    it("records a successful CI result together with the ci_succeeded lifecycle status, atomically", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();

      // Act
      const outcome = await repository.recordCiResult(executionRunId, succeeded);

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.status).toBe("ci_succeeded");
      expect(data?.ci?.commitSha).toBe(commitSha);
      expect(data?.ci?.state).toBe("succeeded");
      expect(data?.ci?.runId).toBe(1);
      expect(data?.ci?.htmlUrl).toBe(succeeded.htmlUrl);
      expect(data?.ci?.conclusion).toBeUndefined();
      expect(data?.ci?.recordedAt).toBeInstanceOf(Timestamp);
    });

    it("records a failed CI result together with the ci_failed lifecycle status, atomically", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();

      // Act
      const outcome = await repository.recordCiResult(executionRunId, failed);

      // Assert
      expect(outcome).toEqual({ outcome: "created" });
      const data = (await docRef.get()).data();
      expect(data?.status).toBe("ci_failed");
      expect(data?.ci?.state).toBe("failed");
      expect(data?.ci?.conclusion).toBe("failure");
    });

    it("idempotently accepts recording the exact same commit SHA and terminal state that is already persisted", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      await repository.recordCiResult(executionRunId, succeeded);
      const firstRecordedAt = (await docRef.get()).data()?.ci?.recordedAt;

      // Act
      const outcome = await repository.recordCiResult(executionRunId, succeeded);

      // Assert
      expect(outcome).toEqual({ outcome: "already_recorded" });
      const data = (await docRef.get()).data();
      expect(data?.ci?.recordedAt).toEqual(firstRecordedAt);
      expect(data?.status).toBe("ci_succeeded");
    });

    it("refuses to overwrite an already-persisted CI result for a conflicting commit SHA", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      await repository.recordCiResult(executionRunId, succeeded);

      // Act
      const outcome = await repository.recordCiResult(executionRunId, { ...succeeded, commitSha: otherCommitSha });

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.ci?.commitSha).toBe(commitSha);
      expect(data?.status).toBe("ci_succeeded");
    });

    it("refuses to overwrite an already-persisted CI result with a conflicting terminal state for the same commit SHA", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      await repository.recordCiResult(executionRunId, succeeded);

      // Act
      const outcome = await repository.recordCiResult(executionRunId, failed);

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const data = (await docRef.get()).data();
      expect(data?.ci?.state).toBe("succeeded");
      expect(data?.status).toBe("ci_succeeded");
    });

    it("treats a missing execution run at write time as a conflict and creates no CI state", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      const repository = createFirestoreExecutionRunRepository();

      // Act
      const outcome = await repository.recordCiResult(executionRunId, succeeded);

      // Assert
      expect(outcome).toEqual({ outcome: "conflict" });
      const snapshot = await docRef.get();
      expect(snapshot.exists).toBe(false);
    });

    it("given many concurrent recordings of the same CI result, exactly one create is persisted and the rest are idempotent", async () => {
      // Arrange
      const executionRunId = `req-${randomUUID()}`;
      const docRef = firestore.collection("executionRuns").doc(executionRunId);
      await docRef.set({ status: "accepted" });
      const repository = createFirestoreExecutionRunRepository();
      const attemptCount = 5;

      // Act
      const outcomes = await Promise.all(
        Array.from({ length: attemptCount }, () => repository.recordCiResult(executionRunId, succeeded)),
      );

      // Assert
      expect(outcomes.filter((outcome) => outcome.outcome === "created")).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome.outcome === "already_recorded")).toHaveLength(attemptCount - 1);
      const data = (await docRef.get()).data();
      expect(data?.ci?.commitSha).toBe(commitSha);
      expect(data?.status).toBe("ci_succeeded");
    });
  },
);
