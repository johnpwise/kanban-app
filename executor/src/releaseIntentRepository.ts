import { getApp, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

import { parseReleaseIntentDocument } from "./schemas/releaseIntentDocument";

import type { Firestore } from "firebase-admin/firestore";

const RELEASE_INTENTS_COLLECTION = "releaseIntents";

export interface ReleaseIntentIdentity {
  repository: string;
  version: string;
  sourceBranch: string;
  sourceRevision: string;
}

export type RecordReleaseIntentOutcome = { outcome: "created" } | { outcome: "already_recorded" } | { outcome: "conflict" };

/** The full trusted release-start identity a completion controller has independently verified —
 * either a freshly completed guarded mutation, or a safely reconciled crash-recovery result. Every
 * field except `releaseBranch`/`commitSha` must agree exactly with the persisted, immutable release
 * intent this result is recorded against. */
export interface ReleaseStartResultIdentity extends ReleaseIntentIdentity {
  releaseBranch: string;
  commitSha: string;
}

export type RecordReleaseStartResultOutcome =
  | { outcome: "created" }
  | { outcome: "already_recorded" }
  | { outcome: "conflict" }
  | { outcome: "release_intent_not_found" }
  | { outcome: "release_intent_invalid" }
  | { outcome: "release_intent_identity_mismatch" };

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
  /**
   * Durably records a trusted release-start result — the crash-safe completion of a guarded
   * release-start mutation — on the existing `releaseIntents/{releaseIntentId}` document, associated
   * with (never replacing) its immutable release identity. Fails closed rather than writing when:
   * the intent document does not exist (`release_intent_not_found`); it exists but fails
   * `parseReleaseIntentDocument` schema validation (`release_intent_invalid`); or it validates but
   * its immutable `(repository, version, sourceBranch, sourceRevision)` disagrees with the supplied
   * `identity` (`release_intent_identity_mismatch`) — a caller can never persist a release-start
   * result against a release intent it does not exactly match.
   *
   * Once those checks pass: if no `start` is present yet, sets `{ releaseBranch, commitSha,
   * recordedAt }` (a Firestore server timestamp — never a caller-supplied value) and returns
   * `{ outcome: "created" }`; if one is already present with the identical `(releaseBranch,
   * commitSha)` (this call or a concurrent one committed first), returns
   * `{ outcome: "already_recorded" }` without writing; if one is already present with a *differing*
   * `releaseBranch` or `commitSha`, returns `{ outcome: "conflict" }` without writing — an
   * established start result is never silently overwritten. Read-check-write happens inside a single
   * Firestore transaction, mirroring every other idempotent write in this module.
   */
  recordReleaseStartResult(releaseIntentId: string, identity: ReleaseStartResultIdentity): Promise<RecordReleaseStartResultOutcome>;
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

    async recordReleaseStartResult(releaseIntentId: string, identity: ReleaseStartResultIdentity) {
      const firestore = getReleaseIntentFirestore();
      const docRef = firestore.collection(RELEASE_INTENTS_COLLECTION).doc(releaseIntentId);

      return firestore.runTransaction<RecordReleaseStartResultOutcome>(async (transaction) => {
        const snapshot = await transaction.get(docRef);
        if (!snapshot.exists) {
          return { outcome: "release_intent_not_found" };
        }

        let intent;
        try {
          intent = parseReleaseIntentDocument(releaseIntentId, snapshot.data());
        } catch {
          return { outcome: "release_intent_invalid" };
        }

        if (
          intent.repository !== identity.repository ||
          intent.version !== identity.version ||
          intent.sourceBranch !== identity.sourceBranch ||
          intent.sourceRevision !== identity.sourceRevision
        ) {
          return { outcome: "release_intent_identity_mismatch" };
        }

        if (!intent.start) {
          transaction.update(docRef, {
            start: {
              releaseBranch: identity.releaseBranch,
              commitSha: identity.commitSha,
              recordedAt: FieldValue.serverTimestamp(),
            },
          });
          return { outcome: "created" };
        }

        if (intent.start.releaseBranch === identity.releaseBranch && intent.start.commitSha === identity.commitSha) {
          return { outcome: "already_recorded" };
        }

        return { outcome: "conflict" };
      });
    },
  };
}
