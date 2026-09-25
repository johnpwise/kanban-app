import { deriveReleaseVersionFromIntentId, parseReleaseIntentDocument } from "./schemas/releaseIntentDocument";

import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ObserveGitRefSha } from "./releaseRepositoryObservation";
import type { ExecutorLogger } from "./runExecutor";

export interface EnsureReleaseIntentRecordedParams {
  releaseIntentId: string;
  /** The trusted repository/source-branch identity — this controller's own deploy-time
   * configuration (`releaseControllerConfig.ts`), never derived from the caller or the Firebase
   * launcher. Named `expectedRepository`/`expectedSourceBranch` to mirror
   * `evaluateReleaseEligibility`'s own identically-purposed params. */
  expectedRepository: string;
  expectedSourceBranch: string;
  /** Reused unmodified — only `loadReleaseIntentData`/`recordReleaseIntent` are called here. */
  repository: ReleaseIntentRepository;
  observeGitRef: ObserveGitRefSha;
  logger?: ExecutorLogger;
}

export type EnsureReleaseIntentRecordedOutcome =
  | {
      outcome: "recorded";
      releaseIntentId: string;
      repository: string;
      version: string;
      sourceBranch: string;
      sourceRevision: string;
    }
  | { outcome: "release_intent_resolution_load_error"; releaseIntentId: string }
  | { outcome: "release_intent_resolution_invalid"; releaseIntentId: string }
  | { outcome: "release_intent_resolution_repository_mismatch"; releaseIntentId: string }
  | { outcome: "release_intent_resolution_source_branch_mismatch"; releaseIntentId: string }
  | { outcome: "release_intent_resolution_version_undecodable"; releaseIntentId: string }
  | { outcome: "release_intent_resolution_source_branch_observation_error"; releaseIntentId: string }
  | { outcome: "release_intent_resolution_source_branch_not_found"; releaseIntentId: string }
  | { outcome: "release_intent_resolution_conflict"; releaseIntentId: string }
  | { outcome: "release_intent_resolution_persistence_error"; releaseIntentId: string };

/**
 * The step that closes the gap between "the Firebase launcher passes only `releaseIntentId`" and
 * "`evaluateReleaseEligibility` requires the release intent to already be durably persisted":
 * idempotently ensures `releaseIntents/{releaseIntentId}` exists with an identity trusted by this
 * controller's own configuration, resolving a fresh `sourceRevision` from GitHub and recording it
 * via the existing, unmodified `recordReleaseIntent` only when no matching intent is present yet.
 *
 * Never trusts a persisted intent whose `repository`/`sourceBranch` disagrees with this run's own
 * trusted configuration — a redelivered/replayed Job execution that somehow targets a different
 * intent's id must fail closed, not silently adopt the persisted values. `version` is never
 * caller-supplied: it is decoded from the trusted `releaseIntentId` itself
 * (`deriveReleaseVersionFromIntentId`), which is only possible because `releaseIntentId` is
 * deterministically derived from `(repository, version)` by construction
 * (`deriveReleaseIntentId`) — ADA never infers or chooses a version here, it only decodes the one
 * already embedded in the trusted identifier it was given.
 *
 * Idempotent by construction: a redelivered Firebase launch computes the identical
 * `releaseIntentId` and hits either the "already persisted" short-circuit above, or
 * `recordReleaseIntent`'s own `already_recorded` convergence — never a second GitHub-observation-
 * driven persistence attempt racing a first.
 */
export async function ensureReleaseIntentRecorded(
  params: EnsureReleaseIntentRecordedParams,
): Promise<EnsureReleaseIntentRecordedOutcome> {
  const { releaseIntentId, expectedRepository, expectedSourceBranch, repository, observeGitRef, logger } = params;
  const safeIdentifiers = { releaseIntentId };

  let existingData: unknown;
  try {
    existingData = await repository.loadReleaseIntentData(releaseIntentId);
  } catch {
    logger?.error("Unexpected failure loading the release intent for resolution.", safeIdentifiers);
    return { outcome: "release_intent_resolution_load_error", releaseIntentId };
  }

  if (existingData !== undefined) {
    let existing;
    try {
      existing = parseReleaseIntentDocument(releaseIntentId, existingData);
    } catch {
      logger?.error("The persisted release intent document failed schema validation.", safeIdentifiers);
      return { outcome: "release_intent_resolution_invalid", releaseIntentId };
    }

    if (existing.repository !== expectedRepository) {
      logger?.error("The persisted release intent's repository disagrees with the trusted configuration.", safeIdentifiers);
      return { outcome: "release_intent_resolution_repository_mismatch", releaseIntentId };
    }
    if (existing.sourceBranch !== expectedSourceBranch) {
      logger?.error("The persisted release intent's sourceBranch disagrees with the trusted configuration.", safeIdentifiers);
      return { outcome: "release_intent_resolution_source_branch_mismatch", releaseIntentId };
    }

    return {
      outcome: "recorded",
      releaseIntentId,
      repository: existing.repository,
      version: existing.version,
      sourceBranch: existing.sourceBranch,
      sourceRevision: existing.sourceRevision,
    };
  }

  const version = deriveReleaseVersionFromIntentId(releaseIntentId, expectedRepository);
  if (!version) {
    logger?.error("The release intent id could not be decoded against the trusted repository.", safeIdentifiers);
    return { outcome: "release_intent_resolution_version_undecodable", releaseIntentId };
  }

  const observation = await observeGitRef({ repository: expectedRepository, ref: `heads/${expectedSourceBranch}` });
  if (!observation.ok) {
    logger?.error("Failed to freshly observe the trusted source branch.", { ...safeIdentifiers, reason: observation.reason });
    return { outcome: "release_intent_resolution_source_branch_observation_error", releaseIntentId };
  }
  if (!observation.found) {
    logger?.error("The trusted source branch does not exist.", safeIdentifiers);
    return { outcome: "release_intent_resolution_source_branch_not_found", releaseIntentId };
  }

  let recordOutcome;
  try {
    recordOutcome = await repository.recordReleaseIntent(releaseIntentId, {
      repository: expectedRepository,
      version,
      sourceBranch: expectedSourceBranch,
      sourceRevision: observation.sha,
    });
  } catch {
    logger?.error("Unexpected failure durably recording the release intent.", safeIdentifiers);
    return { outcome: "release_intent_resolution_persistence_error", releaseIntentId };
  }

  if (recordOutcome.outcome === "conflict") {
    logger?.error("A conflicting release intent is already durably recorded.", safeIdentifiers);
    return { outcome: "release_intent_resolution_conflict", releaseIntentId };
  }

  logger?.info("Release intent resolved and durably recorded.", safeIdentifiers);
  return {
    outcome: "recorded",
    releaseIntentId,
    repository: expectedRepository,
    version,
    sourceBranch: expectedSourceBranch,
    sourceRevision: observation.sha,
  };
}
