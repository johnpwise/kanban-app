import { getApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import type { Firestore } from "firebase-admin/firestore";

const RELEASE_INTENTS_COLLECTION = "releaseIntents";

export interface ReleaseIntentIdentity {
  repository: string;
  version: string;
  sourceBranch: string;
  sourceRevision: string;
}

export type RecordReleaseIntentOutcome = { outcome: "created" } | { outcome: "already_recorded" } | { outcome: "conflict" };

export interface ReleaseIntentRepository {
  /** Returns the raw document data, or `undefined` if no such document exists. Never writes. */
  loadReleaseIntentData(releaseIntentId: string): Promise<unknown | undefined>;
  /**
   * Durably records an explicit release intent on `releaseIntents/{releaseIntentId}`: if no
   * document is present yet, creates one with `{ releaseIntentId, repository, version,
   * sourceBranch, sourceRevision, requestedAt }` and returns `{ outcome: "created" }`; if one is
   * already present with the identical `(repository, version, sourceBranch, sourceRevision)`
   * identity (this call or a concurrent one committed first), returns
   * `{ outcome: "already_recorded" }` without writing; if one is already present with any
   * differing field, returns `{ outcome: "conflict" }` without writing — a conflicting intent is
   * never silently overwritten, and the caller (a future release-start controller) decides whether
   * a new release intent under a different id is required. Read-check-write happens inside a
   * single Firestore transaction, mirroring `executionRunRepository.ts`'s idempotency pattern.
   */
  recordReleaseIntent(releaseIntentId: string, identity: ReleaseIntentIdentity): Promise<RecordReleaseIntentOutcome>;
}

let firestore: Firestore | undefined;

/**
 * Lazily initializes the Admin SDK (Application Default Credentials in the deployed container).
 * Deliberately a separate small singleton from `executionRunRepository.ts`'s own — these are two
 * narrow, independently-owned collections, and the codebase's existing convention (see
 * `executionRunDocument.ts`'s docstring) already favors this kind of small, decoupled duplication
 * over a shared Firestore-access module for a handful of stable lines.
 */
function getReleaseIntentFirestore(): Firestore {
  if (!firestore) {
    try {
      getApp();
    } catch {
      initializeApp();
    }
    firestore = getFirestore();
  }
  return firestore;
}

/**
 * Reads/writes `releaseIntents/{releaseIntentId}` by its deterministic document ID only — never a
 * query by field.
 */
export function createFirestoreReleaseIntentRepository(): ReleaseIntentRepository {
  return {
    async loadReleaseIntentData(releaseIntentId: string) {
      const snapshot = await getReleaseIntentFirestore().collection(RELEASE_INTENTS_COLLECTION).doc(releaseIntentId).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },

    async recordReleaseIntent(releaseIntentId: string, identity: ReleaseIntentIdentity) {
      const firestore = getReleaseIntentFirestore();
      const docRef = firestore.collection(RELEASE_INTENTS_COLLECTION).doc(releaseIntentId);

      return firestore.runTransaction<RecordReleaseIntentOutcome>(async (transaction) => {
        const snapshot = await transaction.get(docRef);

        if (!snapshot.exists) {
          transaction.set(docRef, {
            releaseIntentId,
            repository: identity.repository,
            version: identity.version,
            sourceBranch: identity.sourceBranch,
            sourceRevision: identity.sourceRevision,
            requestedAt: FieldValue.serverTimestamp(),
          });
          return { outcome: "created" };
        }

        const existing = snapshot.data() as
          | { repository?: unknown; version?: unknown; sourceBranch?: unknown; sourceRevision?: unknown }
          | undefined;

        if (
          existing?.repository === identity.repository &&
          existing?.version === identity.version &&
          existing?.sourceBranch === identity.sourceBranch &&
          existing?.sourceRevision === identity.sourceRevision
        ) {
          return { outcome: "already_recorded" };
        }

        return { outcome: "conflict" };
      });
    },
  };
}
