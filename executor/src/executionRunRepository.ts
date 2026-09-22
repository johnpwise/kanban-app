import { getApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import type { Firestore } from "firebase-admin/firestore";

const EXECUTION_RUNS_COLLECTION = "executionRuns";

export type ClaimExecutionRunOutcome = { claimed: true } | { claimed: false; reason: "already_claimed" };

export type RecordSourceRevisionOutcome = { outcome: "created" } | { outcome: "already_recorded" } | { outcome: "conflict" };

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
  };
}
