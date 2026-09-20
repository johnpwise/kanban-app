import { randomUUID } from "node:crypto";

import { PubSub } from "@google-cloud/pubsub";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const pubsubEmulatorHost = process.env.PUBSUB_EMULATOR_HOST;
const describeWithEmulators = firestoreEmulatorHost && pubsubEmulatorHost ? describe : describe.skip;

function validBody(executionRequestId: string) {
  return {
    schemaVersion: 1,
    eventType: "ada.execution.requested",
    executionRequestId,
    correlationId: executionRequestId,
    projectId: "project-1",
    cardId: "card-1",
    title: "Ship the demo",
    prompt: "Ship the demo build.",
    repository: "johnpwise/kanban-app",
    baseBranch: "develop",
    requestedBy: "user-1",
    requestedAt: "2026-09-20T00:00:00.000Z",
  };
}

function attributesFor(body: ReturnType<typeof validBody>) {
  return {
    schemaVersion: String(body.schemaVersion),
    eventType: body.eventType,
    executionRequestId: body.executionRequestId,
    correlationId: body.correlationId,
  };
}

async function waitFor<T>(check: () => Promise<T | undefined>, timeoutMs: number, intervalMs = 250): Promise<T | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) return undefined;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describeWithEmulators(
  "ADA Pub/Sub consumer (Firestore + Functions + Pub/Sub emulators)",
  () => {
    const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
    const topicName = "ada-execution-requests";
    const app = initializeApp({ projectId }, `functions-consumer-integration-${randomUUID()}`);
    const firestore = getFirestore(app);
    const pubsub = new PubSub({ projectId });

    beforeAll(async () => {
      expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
      expect(pubsubEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
      await pubsub.topic(topicName).get({ autoCreate: true });
    }, 30_000);

    afterAll(async () => {
      await firestore.recursiveDelete(firestore.collection("executionRuns"));
      await deleteApp(app);
    });

    it(
      "creates exactly one accepted executionRuns document for a valid message, and ignores a redelivered duplicate",
      async () => {
        const executionRequestId = `req-${randomUUID()}`;
        const body = validBody(executionRequestId);
        const data = Buffer.from(JSON.stringify(body), "utf8");
        const attributes = attributesFor(body);

        await pubsub.topic(topicName).publishMessage({ data, attributes });

        const created = await waitFor(async () => {
          const snapshot = await firestore.collection("executionRuns").doc(executionRequestId).get();
          return snapshot.exists ? snapshot.data() : undefined;
        }, 25_000);

        expect(created).toBeDefined();
        expect(created?.status).toBe("accepted");
        expect(created?.correlationId).toBe(executionRequestId);
        expect(created?.input?.title).toBe(body.title);

        // Redeliver the identical logical message and give the consumer time to process it.
        await pubsub.topic(topicName).publishMessage({ data, attributes });
        await new Promise((resolve) => setTimeout(resolve, 5_000));

        const snapshot = await firestore
          .collection("executionRuns")
          .where("executionRequestId", "==", executionRequestId)
          .get();
        expect(snapshot.size).toBe(1);
      },
      40_000,
    );

    it(
      "creates exactly one document from two concurrently published duplicate deliveries",
      async () => {
        const executionRequestId = `req-${randomUUID()}`;
        const body = validBody(executionRequestId);
        const data = Buffer.from(JSON.stringify(body), "utf8");
        const attributes = attributesFor(body);

        await Promise.all([
          pubsub.topic(topicName).publishMessage({ data, attributes }),
          pubsub.topic(topicName).publishMessage({ data, attributes }),
        ]);

        await waitFor(async () => {
          const snapshot = await firestore.collection("executionRuns").doc(executionRequestId).get();
          return snapshot.exists ? snapshot.data() : undefined;
        }, 25_000);
        // Give a second concurrent delivery time to have been processed too, if it was going to be.
        await new Promise((resolve) => setTimeout(resolve, 5_000));

        const snapshot = await firestore
          .collection("executionRuns")
          .where("executionRequestId", "==", executionRequestId)
          .get();
        expect(snapshot.size).toBe(1);
      },
      40_000,
    );

    it(
      "leaves the related Card untouched (still queued) after accepting a run",
      async () => {
        const executionRequestId = `req-${randomUUID()}`;
        const projectId = `project-${randomUUID()}`;
        const cardId = `card-${randomUUID()}`;
        const cardRef = firestore.doc(`projects/${projectId}/cards/${cardId}`);
        const cardFixture = {
          title: "Ship the demo",
          label: null,
          createdAt: Timestamp.now(),
          notes: null,
          dueDate: null,
          prompt: "Ship the demo build.",
          executionStatus: "queued",
          createdBy: "user-1",
          updatedAt: Timestamp.now(),
        };
        await cardRef.set(cardFixture);

        const body = validBody(executionRequestId);
        body.projectId = projectId;
        body.cardId = cardId;
        const data = Buffer.from(JSON.stringify(body), "utf8");

        await pubsub.topic(topicName).publishMessage({ data, attributes: attributesFor(body) });

        await waitFor(async () => {
          const snapshot = await firestore.collection("executionRuns").doc(executionRequestId).get();
          return snapshot.exists ? snapshot.data() : undefined;
        }, 25_000);

        const cardSnapshot = await cardRef.get();
        expect(cardSnapshot.data()?.executionStatus).toBe("queued");
        expect(cardSnapshot.data()?.updatedAt).toEqual(cardFixture.updatedAt);

        await cardRef.delete();
      },
      40_000,
    );

    it(
      "does not create an executionRuns document for an invalid message",
      async () => {
        const executionRequestId = `req-${randomUUID()}`;

        await pubsub.topic(topicName).publishMessage({
          data: Buffer.from("not valid json", "utf8"),
          attributes: {
            schemaVersion: "1",
            eventType: "ada.execution.requested",
            executionRequestId,
            correlationId: executionRequestId,
          },
        });

        await new Promise((resolve) => setTimeout(resolve, 8_000));

        const snapshot = await firestore.collection("executionRuns").doc(executionRequestId).get();
        expect(snapshot.exists).toBe(false);
      },
      20_000,
    );
  },
);
