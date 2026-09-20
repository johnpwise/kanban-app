import { getApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import type { Firestore } from "firebase-admin/firestore";

const EXECUTION_RUNS_COLLECTION = "executionRuns";

export interface ExecutionRunRepository {
  /** Returns the raw document data, or `undefined` if no such document exists. Never writes. */
  loadExecutionRunData(executionRunId: string): Promise<unknown | undefined>;
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
  };
}
