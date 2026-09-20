import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import * as logger from "firebase-functions/logger";

import { createFirestoreExecutionRunTransaction } from "./firestoreExecutionRunTransaction";
import { handleAdaExecutionRequestPublished } from "./onAdaExecutionRequestPublished";
import { dispatchTopicName, handleExecutionRequestCreated } from "./onExecutionRequestCreated";

/**
 * Region matches the project's single Firestore database (`kanban-app-fa4b7`, locationId
 * `europe-west2`, confirmed via read-only inspection) so the trigger is co-located with the data.
 */
export const dispatchAdaExecutionRequest = onDocumentCreated(
  {
    document: "executionRequests/{executionRequestId}",
    region: "europe-west2",
    // Transient publish failures are rethrown by handleExecutionRequestCreated so Firebase
    // retries the event; without this the event is dropped after a single failed attempt.
    // https://firebase.google.com/docs/functions/retries
    retry: true,
  },
  handleExecutionRequestCreated,
);

/**
 * Consumes the same topic the dispatcher above publishes to. Region matches the dispatcher and
 * the project's single Firestore database location for the same reason (co-located with the
 * data it writes to `executionRuns/{executionRequestId}`).
 */
export const acceptAdaExecutionRun = onMessagePublished(
  {
    // Passed as the raw param, not `.value()`: firebase-functions resolves an Expression given
    // directly to a config field at deploy time; `.value()` only reads `process.env` at runtime.
    topic: dispatchTopicName,
    region: "europe-west2",
    // A permanent validation failure is caught and acknowledged by the handler itself; only a
    // Firestore/transaction failure reaches the platform, so retrying is always the right call.
    // https://firebase.google.com/docs/functions/retries
    retry: true,
  },
  async (event) => {
    const { message } = event.data;
    await handleAdaExecutionRequestPublished({
      data: message.data,
      attributes: message.attributes,
      transportMessageId: message.messageId,
      createRunTransaction: createFirestoreExecutionRunTransaction,
      logger,
    });
  },
);
