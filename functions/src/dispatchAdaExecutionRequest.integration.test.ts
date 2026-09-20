import { randomUUID } from "node:crypto";

import { PubSub } from "@google-cloud/pubsub";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Message, Subscription } from "@google-cloud/pubsub";

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const pubsubEmulatorHost = process.env.PUBSUB_EMULATOR_HOST;
const describeWithEmulators = firestoreEmulatorHost && pubsubEmulatorHost ? describe : describe.skip;

function waitForMessage(subscription: Subscription, timeoutMs: number): Promise<Message | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      subscription.removeListener("message", onMessage);
      resolve(null);
    }, timeoutMs);

    function onMessage(message: Message) {
      clearTimeout(timer);
      subscription.removeListener("message", onMessage);
      message.ack();
      resolve(message);
    }

    subscription.on("message", onMessage);
  });
}

describeWithEmulators(
  "ADA execution request dispatcher (Firestore + Functions + Pub/Sub emulators)",
  () => {
    const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
    const topicName = "ada-execution-requests";
    const app = initializeApp({ projectId }, `functions-integration-${randomUUID()}`);
    const firestore = getFirestore(app);
    const pubsub = new PubSub({ projectId });
    let subscription: Subscription;

    beforeAll(async () => {
      expect(firestoreEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);
      expect(pubsubEmulatorHost).toMatch(/^127\.0\.0\.1:\d+$/);

      const [topic] = await pubsub.topic(topicName).get({ autoCreate: true });
      [subscription] = await topic.createSubscription(`test-sub-${randomUUID()}`);
    }, 30_000);

    afterAll(async () => {
      await firestore.recursiveDelete(firestore.collection("executionRequests"));
      await subscription.delete().catch(() => undefined);
      await deleteApp(app);
    });

    it(
      "should invoke the dispatcher and publish the mapped message when an execution request document is created",
      async () => {
        const requestedAt = Timestamp.now();
        const docRef = await firestore.collection("executionRequests").add({
          projectId: "project-1",
          cardId: "card-1",
          title: "Ship the demo",
          prompt: "Ship the demo build.",
          repository: "johnpwise/kanban-app",
          baseBranch: "develop",
          requestedBy: "user-1",
          requestedAt,
        });

        const message = await waitForMessage(subscription, 25_000);

        expect(message).not.toBeNull();
        const payload = JSON.parse(message!.data.toString("utf8"));
        expect(payload).toEqual({
          schemaVersion: 1,
          eventType: "ada.execution.requested",
          executionRequestId: docRef.id,
          correlationId: docRef.id,
          projectId: "project-1",
          cardId: "card-1",
          title: "Ship the demo",
          prompt: "Ship the demo build.",
          repository: "johnpwise/kanban-app",
          baseBranch: "develop",
          requestedBy: "user-1",
          requestedAt: requestedAt.toDate().toISOString(),
        });
        expect(message!.attributes).toEqual({
          schemaVersion: "1",
          eventType: "ada.execution.requested",
          executionRequestId: docRef.id,
          correlationId: docRef.id,
        });
      },
      30_000,
    );
  },
);
