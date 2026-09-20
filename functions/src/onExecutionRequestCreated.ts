import { PubSub } from "@google-cloud/pubsub";
import { defineString } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";

import { dispatchExecutionRequest } from "./dispatchExecutionRequest";

import type { FirestoreEvent, QueryDocumentSnapshot } from "firebase-functions/v2/firestore";

/** Configurable so the topic can change per environment without a code change. */
export const dispatchTopicName = defineString("DISPATCH_TOPIC_NAME", {
  default: "ada-execution-requests",
});

let pubSubClient: PubSub | undefined;

function getPubSubClient(): PubSub {
  pubSubClient ??= new PubSub();
  return pubSubClient;
}

function toPlainExecutionRequestData(raw: FirebaseFirestore.DocumentData): unknown {
  const { requestedAt, ...rest } = raw;
  const isTimestampLike =
    requestedAt !== null && typeof requestedAt === "object" && typeof requestedAt.toDate === "function";

  return {
    ...rest,
    requestedAt: isTimestampLike ? requestedAt.toDate().toISOString() : requestedAt,
  };
}

/**
 * `onDocumentCreated` handler for `executionRequests/{executionRequestId}`. Reads the trigger's
 * own event payload only — never reads or writes any other Firestore document, so it cannot
 * mutate the Card or the Execution Request it was triggered by.
 */
export async function handleExecutionRequestCreated(
  event: FirestoreEvent<QueryDocumentSnapshot | undefined, { executionRequestId: string }>,
): Promise<void> {
  const { executionRequestId } = event.params;

  if (!event.data) {
    logger.warn("ADA execution request creation event had no document data; skipping.", {
      executionRequestId,
    });
    return;
  }

  await dispatchExecutionRequest({
    executionRequestId,
    data: toPlainExecutionRequestData(event.data.data()),
    publish: async (data, attributes) => {
      const topic = getPubSubClient().topic(dispatchTopicName.value());
      return topic.publishMessage({ data, attributes });
    },
    logger,
  });
}
