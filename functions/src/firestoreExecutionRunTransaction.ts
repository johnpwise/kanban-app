import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import type { AcceptExecutionRunTransaction, AcceptExecutionRunOutcome, RunAcceptExecutionRunTransaction } from "./acceptExecutionRun";
import type { ExecutionRunDocument } from "./schemas/executionRunDocument";
import type { Firestore } from "firebase-admin/firestore";

const EXECUTION_RUNS_COLLECTION = "executionRuns";

let firestore: Firestore | undefined;

/** Lazily initializes the Admin SDK (Application Default Credentials in deployed Functions). */
function getExecutionRunFirestore(): Firestore {
  if (!firestore) {
    if (getApps().length === 0) {
      initializeApp();
    }
    firestore = getFirestore();
  }
  return firestore;
}

/**
 * Adapts the abstract `AcceptExecutionRunTransaction` contract to a real Firestore transaction on
 * `executionRuns/{executionRequestId}`. The read happens before any write within the same
 * transaction, so Firestore's optimistic-concurrency retry guarantees that concurrent deliveries
 * of the same message cannot both observe "not found" and both create a document.
 */
export function createFirestoreExecutionRunTransaction(executionRequestId: string): RunAcceptExecutionRunTransaction {
  return async (work) => {
    const docRef = getExecutionRunFirestore().collection(EXECUTION_RUNS_COLLECTION).doc(executionRequestId);

    return getExecutionRunFirestore().runTransaction<AcceptExecutionRunOutcome>(async (transaction) => {
      let staged: ExecutionRunDocument | undefined;
      const tx: AcceptExecutionRunTransaction = {
        getExistingRun: async () => {
          const snapshot = await transaction.get(docRef);
          return snapshot.exists ? (snapshot.data() as ExecutionRunDocument) : undefined;
        },
        createRun: (document) => {
          staged = document;
        },
      };

      const outcome = await work(tx);
      if (outcome === "created" && staged) {
        transaction.create(docRef, staged);
      }
      return outcome;
    });
  };
}
