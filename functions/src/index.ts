import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import * as logger from "firebase-functions/logger";

import { adaReleaseRepository } from "./adaReleaseControllerRunLauncherConfig";
import { launchAdaCiControllerJob, launchAdaCiControllerJobInEmulator } from "./adaCiControllerJobLauncher";
import { launchAdaExecutorJob, launchAdaExecutorJobInEmulator } from "./adaExecutorJobLauncher";
import { launchAdaMergeControllerJob, launchAdaMergeControllerJobInEmulator } from "./adaMergeControllerJobLauncher";
import { launchAdaReleaseControllerJob, launchAdaReleaseControllerJobInEmulator } from "./adaReleaseControllerJobLauncher";
import { createFirestoreExecutionRunTransaction } from "./firestoreExecutionRunTransaction";
import { launchAdaMergeControl } from "./launchAdaMergeControl";
import { launchDeliveryCiControl } from "./launchDeliveryCiControl";
import { launchExecutionRun } from "./launchExecutionRun";
import { launchReleaseStart } from "./launchReleaseStart";
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

/**
 * Separate again from both triggers above: this one observes the *update* that follows a
 * successful ADA delivery (`delivery` becoming present on an already-`accepted` run) and launches
 * the separate `ada-ci-controller` Job — the coding executor itself never waits for CI (see
 * `executor/src/runExecutor.ts`; it exits immediately after `recordDelivery`). Most updates on this
 * document are not that transition (`claim`, `sourceRevision`, and later `ci` writes all pass
 * through the same trigger); `launchDeliveryCiControl` fails closed to a no-launch skip for all of
 * them via `isDeliveryEligibleForCiControl`. Region matches the other triggers for the same reason
 * (co-located with the Firestore database they read from).
 */
export const launchAdaDeliveryCiControl = onDocumentUpdated(
  {
    document: "executionRuns/{executionRequestId}",
    region: "europe-west2",
    // A transient Cloud Run API failure is rethrown by launchDeliveryCiControl so Firebase retries
    // the event; redelivery is safe even though it is not a genuine eligibility re-check — a
    // redelivered launch converges on the same durable `(commitSha, state)` idempotency contract in
    // `recordCiResult`, not a new dedup mechanism here.
    // https://firebase.google.com/docs/functions/retries
    retry: true,
    // Must run as the SA granted `roles/run.jobsExecutorWithOverrides` on the `ada-ci-controller`
    // Cloud Run Job. Reuses the same `ada-launcher-runtime` identity as `launchAdaExecutionRun`
    // above; granting it that additional binding on the new Job is a live IAM mutation, deferred to
    // an explicit approval boundary (not performed by this code change).
    serviceAccount: "ada-launcher-runtime@kanban-app-fa4b7.iam.gserviceaccount.com",
  },
  async (event) => {
    await launchDeliveryCiControl({
      documentId: event.params.executionRequestId,
      before: event.data?.before.data(),
      after: event.data?.after.data(),
      eventId: event.id,
      // Same emulator guard as launchAdaExecutionRun above, and for the same reason: emulator-backed
      // integration tests write to executionRuns/{id} directly and must never reach the real Cloud
      // Run Admin API.
      launchJob:
        process.env.FUNCTIONS_EMULATOR === "true" ? launchAdaCiControllerJobInEmulator : launchAdaCiControllerJob,
      logger,
    });
  },
);

/**
 * Separate again from every trigger above: this one observes the *update* that follows a
 * successful CI observation (`status` becoming `ci_succeeded`, recorded by
 * `executor/src/deliveryCiController.ts` via `recordCiResult`) and launches the separate
 * `ada-merge-controller` Job, which re-verifies merge eligibility against fresh GitHub state
 * before performing the guarded one-shot merge (see `executor/src/mergeCompletionController.ts`).
 * Most updates on this document are not that transition (`claim`, `sourceRevision`, `delivery`,
 * and later `merge` writes all pass through the same trigger, as does a transition into
 * `ci_failed`, which must never launch merge completion); `launchAdaMergeControl` fails closed to
 * a no-launch skip for all of them via `isCiSucceededEligibleForMergeControl`. Region matches the
 * other triggers for the same reason (co-located with the Firestore database they read from).
 */
export const launchAdaMergeCompletion = onDocumentUpdated(
  {
    document: "executionRuns/{executionRequestId}",
    region: "europe-west2",
    // A transient Cloud Run API failure is rethrown by launchAdaMergeControl so Firebase retries
    // the event; redelivery is safe even though it is not a genuine eligibility re-check — a
    // redelivered launch converges on the same durable merge-identity idempotency contract in
    // `recordMergeResult`, not a new dedup mechanism here.
    // https://firebase.google.com/docs/functions/retries
    retry: true,
    // Must run as the SA granted `roles/run.jobsExecutorWithOverrides` on the `ada-merge-controller`
    // Cloud Run Job. Reuses the same `ada-launcher-runtime` identity as the other launchers above;
    // granting it that additional binding on the new Job is a live IAM mutation, deferred to an
    // explicit approval boundary (not performed by this code change).
    serviceAccount: "ada-launcher-runtime@kanban-app-fa4b7.iam.gserviceaccount.com",
  },
  async (event) => {
    await launchAdaMergeControl({
      documentId: event.params.executionRequestId,
      before: event.data?.before.data(),
      after: event.data?.after.data(),
      eventId: event.id,
      // Same emulator guard as the other launchers above, and for the same reason: emulator-backed
      // integration tests write to executionRuns/{id} directly and must never reach the real Cloud
      // Run Admin API.
      launchJob:
        process.env.FUNCTIONS_EMULATOR === "true"
          ? launchAdaMergeControllerJobInEmulator
          : launchAdaMergeControllerJob,
      logger,
    });
  },
);

/**
 * Separate from every trigger above: this one is not part of the automatic delivery pipeline at
 * all. It observes the *creation* of an explicit, authenticated release request
 * (`src/actions/startRelease.ts`, app-side) and launches the separate `ada-release-controller`
 * Job, which resolves a fresh source revision, durably records the release intent, and performs a
 * guarded release-start (see `executor/src/releaseControllerMain.ts`). `releaseRequests/{id}`
 * carries only `version` — this handler derives `releaseIntentId` from that version and its own
 * trusted `adaReleaseRepository` configuration (`launchReleaseStart.ts`), never from the document.
 * Region matches the other triggers for the same reason (co-located with the Firestore database
 * they read from).
 */
export const launchAdaReleaseStart = onDocumentCreated(
  {
    document: "releaseRequests/{releaseRequestId}",
    region: "europe-west2",
    // A transient Cloud Run API failure is rethrown by launchReleaseStart so Firebase retries the
    // event; redelivery is safe — it computes the identical deterministic releaseIntentId and
    // converges on the same durable idempotency contracts in recordReleaseIntent/
    // recordReleaseStartResult, not a new dedup mechanism here.
    // https://firebase.google.com/docs/functions/retries
    retry: true,
    // Must run as the SA granted `roles/run.jobsExecutorWithOverrides` on the
    // `ada-release-controller` Cloud Run Job. Reuses the same `ada-launcher-runtime` identity as
    // the other launchers above; granting it that additional binding on the new Job is a live IAM
    // mutation, deferred to an explicit approval boundary (not performed by this code change) —
    // same deferral already recorded for the CI-controller/merge-controller launchers.
    serviceAccount: "ada-launcher-runtime@kanban-app-fa4b7.iam.gserviceaccount.com",
  },
  async (event) => {
    await launchReleaseStart({
      documentId: event.params.releaseRequestId,
      data: event.data?.data(),
      eventId: event.id,
      trustedRepository: adaReleaseRepository.value(),
      // Same emulator guard as the other launchers above, and for the same reason: emulator-backed
      // integration tests write to releaseRequests/{id} directly and must never reach the real
      // Cloud Run Admin API.
      launchJob:
        process.env.FUNCTIONS_EMULATOR === "true" ? launchAdaReleaseControllerJobInEmulator : launchAdaReleaseControllerJob,
      logger,
    });
  },
);
