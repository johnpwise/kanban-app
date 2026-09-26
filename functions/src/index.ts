import { onDocumentCreated, onDocumentUpdated } from "firebase-functions/v2/firestore";
import { onMessagePublished } from "firebase-functions/v2/pubsub";
import * as logger from "firebase-functions/logger";

import { adaReleaseRepository } from "./adaReleaseControllerRunLauncherConfig";
import { launchAdaCiControllerJob, launchAdaCiControllerJobInEmulator } from "./adaCiControllerJobLauncher";
import { launchAdaExecutorJob, launchAdaExecutorJobInEmulator } from "./adaExecutorJobLauncher";
import { launchAdaMergeControllerJob, launchAdaMergeControllerJobInEmulator } from "./adaMergeControllerJobLauncher";
import { launchAdaReleaseCiControllerJob, launchAdaReleaseCiControllerJobInEmulator } from "./adaReleaseCiControllerJobLauncher";
import { launchAdaReleaseControllerJob, launchAdaReleaseControllerJobInEmulator } from "./adaReleaseControllerJobLauncher";
import {
  launchAdaReleasePullRequestControllerJob,
  launchAdaReleasePullRequestControllerJobInEmulator,
} from "./adaReleasePullRequestControllerJobLauncher";
import { createFirestoreExecutionRunTransaction } from "./firestoreExecutionRunTransaction";
import { launchAdaMergeControl } from "./launchAdaMergeControl";
import { launchDeliveryCiControl } from "./launchDeliveryCiControl";
import { launchExecutionRun } from "./launchExecutionRun";
import { launchReleaseCiControl } from "./launchReleaseCiControl";
import { launchReleasePullRequestControl } from "./launchReleasePullRequestControl";
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

/**
 * Separate again from every trigger above: this one observes the *update* that follows a
 * successful, durable release-start completion (`start` becoming present, recorded by
 * `executor/src/releaseStartCompletionController.ts` via `recordReleaseStartResult`) and launches
 * the separate `ada-release-pr-controller` Job, which independently recovers the trusted release
 * intent and freshly reconciles GitHub before creating/reusing and verifying both release Pull
 * Requests (see `executor/src/releasePullRequestControllerMain.ts`). Most updates on this document
 * are not that transition (an unrelated field write, and later `pullRequests` persistence — this
 * very stage's own durable output — all pass through the same trigger);
 * `launchReleasePullRequestControl` fails closed to a no-launch skip for all of them via
 * `isReleaseStartCompletionEligibleForPullRequestControl`. `releaseIntents/{releaseIntentId}` is
 * also written to directly by unrelated emulator-backed integration tests, so — same as every
 * other launcher above — the emulator path swaps in a no-op Job launcher. Region matches the other
 * triggers for the same reason (co-located with the Firestore database they read from).
 */
export const launchAdaReleasePullRequestControl = onDocumentUpdated(
  {
    document: "releaseIntents/{releaseIntentId}",
    region: "europe-west2",
    // A transient Cloud Run API failure is rethrown by launchReleasePullRequestControl so Firebase
    // retries the event; redelivery is safe even though it is not a genuine eligibility re-check —
    // a redelivered launch converges on the same durable per-target PR idempotency contract in
    // `recordReleasePullRequestResult`, not a new dedup mechanism here.
    // https://firebase.google.com/docs/functions/retries
    retry: true,
    // Must run as the SA granted `roles/run.jobsExecutorWithOverrides` on the
    // `ada-release-pr-controller` Cloud Run Job. Reuses the same `ada-launcher-runtime` identity as
    // the other launchers above; granting it that additional binding on the new Job is a live IAM
    // mutation, deferred to an explicit approval boundary (not performed by this code change) —
    // same deferral already recorded for the CI/merge/release-start launchers.
    serviceAccount: "ada-launcher-runtime@kanban-app-fa4b7.iam.gserviceaccount.com",
  },
  async (event) => {
    await launchReleasePullRequestControl({
      documentId: event.params.releaseIntentId,
      before: event.data?.before.data(),
      after: event.data?.after.data(),
      eventId: event.id,
      // Same emulator guard as the other launchers above, and for the same reason: emulator-backed
      // integration tests write to releaseIntents/{id} directly and must never reach the real
      // Cloud Run Admin API.
      launchJob:
        process.env.FUNCTIONS_EMULATOR === "true"
          ? launchAdaReleasePullRequestControllerJobInEmulator
          : launchAdaReleasePullRequestControllerJob,
      logger,
    });
  },
);

/**
 * Separate again from every trigger above: this one observes the *update* that completes the whole
 * release-PR-pair (`pullRequests.main` and `pullRequests.develop` both becoming present, recorded by
 * `executor/src/releasePullRequestCompletionController.ts` via `recordReleasePullRequestResult`)
 * and launches the separate `ada-release-ci-controller` Job, which independently observes and
 * durably finalizes the trusted terminal CI result for both targets in one execution (see
 * `executor/src/releaseCiControllerMain.ts`). `main` and `develop` are persisted as separate
 * document updates, so this trigger checks the whole-pair-completion transition (not both present →
 * both present) via `isReleasePullRequestPairCompletionEligibleForCiControl` and requests at most
 * one launch per eligible event, regardless of which target's write completes the pair. Most
 * updates on this document are not that transition (an unrelated field write, a pair that is still
 * incomplete, a pair that was already complete, and later `ci` persistence — this very stage's own
 * durable output — all pass through the same trigger and are skipped). `releaseIntents/{releaseIntentId}`
 * is also written to directly by unrelated emulator-backed integration tests, so — same as every
 * other launcher above — the emulator path swaps in a no-op Job launcher. Region matches the other
 * triggers for the same reason (co-located with the Firestore database they read from).
 */
export const launchAdaReleaseCiControl = onDocumentUpdated(
  {
    document: "releaseIntents/{releaseIntentId}",
    region: "europe-west2",
    // A transient Cloud Run API failure is rethrown by launchReleaseCiControl so Firebase retries
    // the event; redelivery is safe even though it is not a genuine eligibility re-check — the
    // release-ci-controller independently finalizes both targets within one execution (PR #67), so
    // a redundant launch is a no-op at the controller level, not a new dedup mechanism needed here.
    // https://firebase.google.com/docs/functions/retries
    retry: true,
    // Must run as the SA granted `roles/run.jobsExecutorWithOverrides` on the
    // `ada-release-ci-controller` Cloud Run Job. Reuses the same `ada-launcher-runtime` identity as
    // the other launchers above; granting it that additional binding on the new Job is a live IAM
    // mutation, deferred to an explicit approval boundary (not performed by this code change) —
    // same deferral already recorded for the CI/merge/release-start/release-pr launchers.
    serviceAccount: "ada-launcher-runtime@kanban-app-fa4b7.iam.gserviceaccount.com",
  },
  async (event) => {
    await launchReleaseCiControl({
      documentId: event.params.releaseIntentId,
      before: event.data?.before.data(),
      after: event.data?.after.data(),
      eventId: event.id,
      // Same emulator guard as the other launchers above, and for the same reason: emulator-backed
      // integration tests write to releaseIntents/{id} directly and must never reach the real
      // Cloud Run Admin API.
      launchJob:
        process.env.FUNCTIONS_EMULATOR === "true" ? launchAdaReleaseCiControllerJobInEmulator : launchAdaReleaseCiControllerJob,
      logger,
    });
  },
);
