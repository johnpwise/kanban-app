import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import * as logger from "firebase-functions/logger";

import { launchAdaExecutorJob, launchAdaExecutorJobInEmulator } from "./adaExecutorJobLauncher";
import { createFirestoreExecutionRunTransaction } from "./firestoreExecutionRunTransaction";
import { launchExecutionRun } from "./launchExecutionRun";
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

/**
 * Separate from `acceptAdaExecutionRun` above: that Function's only responsibility is validating
 * the Pub/Sub message and creating the accepted `executionRuns/{id}` document; this one launches
 * compute after that document exists. Region matches the other two triggers for the same reason
 * (co-located with the Firestore database they read from).
 */
export const launchAdaExecutionRun = onDocumentCreated(
  {
    document: "executionRuns/{executionRequestId}",
    region: "europe-west2",
    // A transient Cloud Run API failure is rethrown by launchExecutionRun so Firebase retries the
    // event; a permanent validation/permission/missing-resource/invalid-configuration failure is
    // logged and acknowledged inside the handler instead, so it is never retried forever.
    // https://firebase.google.com/docs/functions/retries
    retry: true,
    // Must run as the SA granted `roles/run.jobsExecutorWithOverrides` on the `ada-executor` Cloud
    // Run Job — the default compute SA has no IAM binding on that Job at all. Without this, every
    // launch attempt fails with PERMISSION_DENIED (classified as permanent, logged and acked, the
    // Job never actually runs).
    serviceAccount: "ada-launcher-runtime@kanban-app-fa4b7.iam.gserviceaccount.com",
  },
  async (event) => {
    await launchExecutionRun({
      documentId: event.params.executionRequestId,
      data: event.data?.data(),
      eventId: event.id,
      // Under the Functions emulator, swap in the no-op launcher: `executionRuns/{id}` is also
      // written to by unrelated emulator-backed integration tests for the Pub/Sub consumer, and
      // those writes must never reach the real Cloud Run Admin API.
      launchJob: process.env.FUNCTIONS_EMULATOR === "true" ? launchAdaExecutorJobInEmulator : launchAdaExecutorJob,
      logger,
    });
  },
);
