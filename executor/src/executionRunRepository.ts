import { getApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import type { Firestore } from "firebase-admin/firestore";

const EXECUTION_RUNS_COLLECTION = "executionRuns";

export type ClaimExecutionRunOutcome = { claimed: true } | { claimed: false; reason: "already_claimed" };

export type RecordSourceRevisionOutcome = { outcome: "created" } | { outcome: "already_recorded" } | { outcome: "conflict" };

export type RecordDeliveryOutcome = { outcome: "created" } | { outcome: "already_recorded" } | { outcome: "conflict" };

export type RecordCiResultOutcome = { outcome: "created" } | { outcome: "already_recorded" } | { outcome: "conflict" };

export interface DeliveryPullRequestIdentity {
  number: number;
  htmlUrl: string;
}

export interface DeliveryIdentity {
  branch: string;
  commitSha: string;
  pullRequest?: DeliveryPullRequestIdentity;
}

export interface CiResult {
  /** The exact verified ADA delivery commit this terminal result is anchored to — never
   * `sourceRevision.headSha`, a branch, or a PR. */
  commitSha: string;
  state: "succeeded" | "failed";
  runId: number;
  htmlUrl: string;
  conclusion?: string;
}

export interface ExecutionRunRepository {
  /** Returns the raw document data, or `undefined` if no such document exists. Never writes. */
  loadExecutionRunData(executionRunId: string): Promise<unknown | undefined>;
  /**
   * Atomically claims `executionRuns/{executionRunId}` for exactly one caller: if no `claim`
   * field is present yet, sets `{ claimId, claimedAt }` and returns `{ claimed: true }`; if a
   * `claim` is already present (this call or a concurrent one committed first), returns
   * `{ claimed: false }` without writing. The read-check-write happens inside a single Firestore
   * transaction, so there is no window between checking and writing for a second caller to race
   * into.
   */
  claimExecutionRun(executionRunId: string, claimId: string): Promise<ClaimExecutionRunOutcome>;
  /**
   * Durably records the exact checked-out Git HEAD SHA on `executionRuns/{executionRunId}`: if no
   * `sourceRevision` is present yet, sets `{ headSha, resolvedAt }` and returns
   * `{ outcome: "created" }`; if one is already present with the same `headSha` (this call or a
   * concurrent one committed first), returns `{ outcome: "already_recorded" }` without writing; if
   * one is already present with a *different* `headSha`, returns `{ outcome: "conflict" }` without
   * writing — a conflicting revision is never silently overwritten. A missing document at write
   * time (the run was just loaded and claimed moments earlier) is treated the same as a conflict:
   * a safe refusal to write, mirroring how `claimExecutionRun` folds a missing document into its
   * existing "do not write" branch rather than adding a distinct outcome. Read-check-write happens
   * inside a single Firestore transaction, same as `claimExecutionRun`.
   */
  recordSourceRevision(executionRunId: string, headSha: string): Promise<RecordSourceRevisionOutcome>;
  /**
   * Durably records ADA's independently-verified GitHub delivery on `executionRuns/{executionRunId}`:
   * if no `delivery` is present yet, sets `{ branch, commitSha, recordedAt, pullRequest? }` and
   * returns `{ outcome: "created" }`; if one is already present with the same `branch` and
   * `commitSha` (this call or a concurrent one committed first), returns
   * `{ outcome: "already_recorded" }` without writing — an already-recorded `pullRequest` is never
   * overwritten by a later call, even one supplying different/no `pullRequest` data; if one is
   * already present with a *different* `branch` or `commitSha`, returns `{ outcome: "conflict" }`
   * without writing. A missing document at write time is treated the same as a conflict, mirroring
   * `recordSourceRevision`. Read-check-write happens inside a single Firestore transaction, same as
   * `recordSourceRevision`.
   */
  recordDelivery(executionRunId: string, delivery: DeliveryIdentity): Promise<RecordDeliveryOutcome>;
  /**
   * Durably records a terminal GitHub Actions CI result on `executionRuns/{executionRunId}`
   * together with the minimum lifecycle `status` transition (`ci_succeeded` / `ci_failed`) — one
   * Firestore transaction, so no reader ever observes `ci` written without the matching `status`
   * or vice versa. Idempotency identity is `(commitSha, state)`: if no `ci` is present yet, sets
   * `{ commitSha, state, runId, htmlUrl, conclusion?, recordedAt }` and the matching `status`,
   * returning `{ outcome: "created" }`; if one is already present with the same `commitSha` and
   * `state` (this call or a concurrent one committed first), returns
   * `{ outcome: "already_recorded" }` without writing — `runId`/`htmlUrl`/`conclusion` are
   * recorded once and never re-verified on repeat calls, mirroring `recordDelivery`'s treatment of
   * `pullRequest`; if one is already present with a *different* `commitSha`, or the *same*
   * `commitSha` but a *different* `state`, returns `{ outcome: "conflict" }` without writing — an
   * established terminal result is never silently overwritten. A missing document at write time is
   * treated the same as a conflict, mirroring `recordSourceRevision`/`recordDelivery`.
   */
  recordCiResult(executionRunId: string, result: CiResult): Promise<RecordCiResultOutcome>;
}

let firestore: Firestore | undefined;

/** Lazily initializes the Admin SDK (Application Default Credentials in the deployed container). */
function getExecutionRunFirestore(): Firestore {
  if (!firestore) {
    try {
      // Checks specifically for the *default* app — a separate named app (e.g. one a test
      // process created for fixture setup) must not suppress this initialization.
      getApp();
    } catch {
      initializeApp();
    }
    firestore = getFirestore();
  }
  return firestore;
}

/**
 * Reads `executionRuns/{executionRunId}` by its deterministic document ID only — never a query by
 * field — and never performs a write.
 */
export function createFirestoreExecutionRunRepository(): ExecutionRunRepository {
  return {
    async loadExecutionRunData(executionRunId: string) {
      const snapshot = await getExecutionRunFirestore().collection(EXECUTION_RUNS_COLLECTION).doc(executionRunId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },

    async claimExecutionRun(executionRunId: string, claimId: string) {
      const firestore = getExecutionRunFirestore();
      const docRef = firestore.collection(EXECUTION_RUNS_COLLECTION).doc(executionRunId);

      return firestore.runTransaction<ClaimExecutionRunOutcome>(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        const existingClaim = (snapshot.data() as { claim?: unknown } | undefined)?.claim;
        if (!snapshot.exists || existingClaim) {
          return { claimed: false, reason: "already_claimed" };
        }

        transaction.update(docRef, {
          claim: { claimId, claimedAt: FieldValue.serverTimestamp() },
        });
        return { claimed: true };
      });
    },

    async recordSourceRevision(executionRunId: string, headSha: string) {
      const firestore = getExecutionRunFirestore();
      const docRef = firestore.collection(EXECUTION_RUNS_COLLECTION).doc(executionRunId);

      return firestore.runTransaction<RecordSourceRevisionOutcome>(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        const existingSourceRevision = (snapshot.data() as { sourceRevision?: { headSha?: unknown } } | undefined)
          ?.sourceRevision;

        if (!snapshot.exists) {
          return { outcome: "conflict" };
        }
        if (!existingSourceRevision) {
          transaction.update(docRef, {
            sourceRevision: { headSha, resolvedAt: FieldValue.serverTimestamp() },
          });
          return { outcome: "created" };
        }
        if (existingSourceRevision.headSha === headSha) {
          return { outcome: "already_recorded" };
        }
        return { outcome: "conflict" };
      });
    },

    async recordDelivery(executionRunId: string, delivery: DeliveryIdentity) {
      const firestore = getExecutionRunFirestore();
      const docRef = firestore.collection(EXECUTION_RUNS_COLLECTION).doc(executionRunId);

      return firestore.runTransaction<RecordDeliveryOutcome>(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        const existingDelivery = (
          snapshot.data() as { delivery?: { branch?: unknown; commitSha?: unknown } } | undefined
        )?.delivery;

        if (!snapshot.exists) {
          return { outcome: "conflict" };
        }
        if (!existingDelivery) {
          transaction.update(docRef, {
            delivery: {
              branch: delivery.branch,
              commitSha: delivery.commitSha,
              recordedAt: FieldValue.serverTimestamp(),
              ...(delivery.pullRequest ? { pullRequest: delivery.pullRequest } : {}),
            },
          });
          return { outcome: "created" };
        }
        if (existingDelivery.branch === delivery.branch && existingDelivery.commitSha === delivery.commitSha) {
          return { outcome: "already_recorded" };
        }
        return { outcome: "conflict" };
      });
    },

    async recordCiResult(executionRunId: string, result: CiResult) {
      const firestore = getExecutionRunFirestore();
      const docRef = firestore.collection(EXECUTION_RUNS_COLLECTION).doc(executionRunId);
      const status = result.state === "succeeded" ? "ci_succeeded" : "ci_failed";

      return firestore.runTransaction<RecordCiResultOutcome>(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        const existingCi = (
          snapshot.data() as { ci?: { commitSha?: unknown; state?: unknown } } | undefined
        )?.ci;

        if (!snapshot.exists) {
          return { outcome: "conflict" };
        }
        if (!existingCi) {
          transaction.update(docRef, {
            ci: {
              commitSha: result.commitSha,
              state: result.state,
              runId: result.runId,
              htmlUrl: result.htmlUrl,
              recordedAt: FieldValue.serverTimestamp(),
              ...(result.conclusion ? { conclusion: result.conclusion } : {}),
            },
            status,
          });
          return { outcome: "created" };
        }
        if (existingCi.commitSha === result.commitSha && existingCi.state === result.state) {
          return { outcome: "already_recorded" };
        }
        return { outcome: "conflict" };
      });
    },
  };
}
