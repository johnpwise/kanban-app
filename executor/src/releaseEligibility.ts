import { parseReleaseIntentDocument, releaseVersionSchema, isReleaseVersionGreaterThan } from "./schemas/releaseIntentDocument";

import type { ExecutorLogger } from "./runExecutor";
import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ObserveGitRefSha, ObservePackageVersion } from "./releaseRepositoryObservation";

export interface EvaluateReleaseEligibilityParams {
  releaseIntentId: string;
  /** The identity reconciliation inputs — supplied by the caller (a future release-start
   * controller), never hardcoded, mirroring how `evaluateMergeEligibility`'s caller supplies
   * `observePullRequest`. */
  expectedRepository: string;
  expectedSourceBranch: string;
  /** Reused unmodified — only `loadReleaseIntentData` is called; never a write. */
  repository: ReleaseIntentRepository;
  observeGitRef: ObserveGitRefSha;
  observePackageVersion: ObservePackageVersion;
  logger?: ExecutorLogger;
}

export type ReleaseEligibilityOutcome =
  | {
      eligible: true;
      releaseIntentId: string;
      repository: string;
      version: string;
      sourceBranch: string;
      sourceRevision: string;
    }
  | { eligible: false; reason: "release_intent_load_error" }
  | { eligible: false; reason: "release_intent_not_found" }
  | { eligible: false; reason: "release_intent_invalid" }
  | { eligible: false; reason: "repository_mismatch" }
  | { eligible: false; reason: "source_branch_mismatch" }
  | { eligible: false; reason: "source_branch_observation_error" }
  | { eligible: false; reason: "source_branch_not_found" }
  | { eligible: false; reason: "source_revision_drift"; expectedSourceRevision: string; actualSourceRevision: string }
  | { eligible: false; reason: "current_version_observation_error" }
  | { eligible: false; reason: "current_version_not_found" }
  | { eligible: false; reason: "current_version_invalid" }
  | { eligible: false; reason: "requested_version_not_greater"; currentVersion: string }
  | { eligible: false; reason: "release_branch_observation_error" }
  | { eligible: false; reason: "release_branch_version_observation_error"; releaseBranch: string }
  | { eligible: false; reason: "release_branch_conflict"; releaseBranch: string }
  | { eligible: false; reason: "already_started"; releaseBranch: string; headSha: string }
  | { eligible: false; reason: "release_tag_observation_error" }
  | { eligible: false; reason: "release_tag_conflict"; tag: string };

/**
 * Evaluates whether a durably-persisted, explicit release intent is currently eligible for a
 * *future* `start-release`-equivalent mutation — this boundary establishes permission only; it
 * never creates a release branch, bumps a version, tags, or performs any GitHub mutation. Fails
 * closed at the first contradiction, in two ordered phases, mirroring `evaluateMergeEligibility`:
 *
 * 1. **Durable-state validation** — the persisted `releaseIntents/{id}` document must exist and
 *    validate against `parseReleaseIntentDocument`, and its `repository`/`sourceBranch` must agree
 *    with the caller-supplied expected identity.
 * 2. **Live reconciliation** — the exact live head SHA of `sourceBranch` is fetched and compared
 *    *exactly* to the persisted `sourceRevision`; any disagreement is reported as an explicit
 *    `source_revision_drift` rather than silently treating the live head as authoritative. The
 *    live `package.json` version, read at the pinned `sourceRevision` (never at a possibly-moved
 *    branch head), must be strictly less than the requested version. A pre-existing
 *    `release/<version>` branch is reconciled by its own `package.json` version: an exact match is
 *    reported as the idempotent `already_started`, any other value as `release_branch_conflict`. A
 *    pre-existing `v<version>` tag is always a hard `release_tag_conflict` — a tag means the
 *    release already completed, so unlike the release branch there is no idempotent-match case.
 *
 * Read-only end-to-end: no Firestore write, no GitHub mutation. A later release-start controller
 * must re-run this evaluation immediately before mutating — this result is never persisted as a
 * standing "approved forever" token.
 */
export async function evaluateReleaseEligibility(
  params: EvaluateReleaseEligibilityParams,
): Promise<ReleaseEligibilityOutcome> {
  const { releaseIntentId, expectedRepository, expectedSourceBranch, repository, observeGitRef, observePackageVersion, logger } =
    params;

  let data: unknown;
  try {
    data = await repository.loadReleaseIntentData(releaseIntentId);
  } catch {
    logger?.error("Unexpected failure loading the persisted release intent.", { releaseIntentId });
    return { eligible: false, reason: "release_intent_load_error" };
  }
  if (data === undefined) {
    logger?.error("Cannot evaluate release eligibility: no such release intent.", { releaseIntentId });
    return { eligible: false, reason: "release_intent_not_found" };
  }

  let intent;
  try {
    intent = parseReleaseIntentDocument(releaseIntentId, data);
  } catch {
    logger?.error("Cannot evaluate release eligibility: the persisted release intent document failed schema validation.", {
      releaseIntentId,
    });
    return { eligible: false, reason: "release_intent_invalid" };
  }

  const safeIdentifiers = { releaseIntentId, repository: intent.repository, version: intent.version };

  if (intent.repository !== expectedRepository) {
    logger?.error("Not eligible: the release intent's repository does not match the expected repository.", safeIdentifiers);
    return { eligible: false, reason: "repository_mismatch" };
  }

  if (intent.sourceBranch !== expectedSourceBranch) {
    logger?.error("Not eligible: the release intent's source branch does not match the expected source branch.", safeIdentifiers);
    return { eligible: false, reason: "source_branch_mismatch" };
  }

  const sourceBranchRef = await observeGitRef({ repository: intent.repository, ref: `heads/${intent.sourceBranch}` });
  if (!sourceBranchRef.ok) {
    logger?.error("Not eligible: observing the live source branch failed.", { ...safeIdentifiers, reason: sourceBranchRef.reason });
    return { eligible: false, reason: "source_branch_observation_error" };
  }
  if (!sourceBranchRef.found) {
    logger?.error("Not eligible: the source branch no longer exists.", safeIdentifiers);
    return { eligible: false, reason: "source_branch_not_found" };
  }
  if (sourceBranchRef.sha !== intent.sourceRevision) {
    logger?.error("Not eligible: the live source branch head has moved away from the trusted source revision.", safeIdentifiers);
    return {
      eligible: false,
      reason: "source_revision_drift",
      expectedSourceRevision: intent.sourceRevision,
      actualSourceRevision: sourceBranchRef.sha,
    };
  }

  const currentVersionObservation = await observePackageVersion({ repository: intent.repository, ref: intent.sourceRevision });
  if (!currentVersionObservation.ok) {
    logger?.error("Not eligible: observing the current package version failed.", {
      ...safeIdentifiers,
      reason: currentVersionObservation.reason,
    });
    return { eligible: false, reason: "current_version_observation_error" };
  }
  if (!currentVersionObservation.found) {
    logger?.error("Not eligible: no package.json exists at the trusted source revision.", safeIdentifiers);
    return { eligible: false, reason: "current_version_not_found" };
  }
  if (!releaseVersionSchema.safeParse(currentVersionObservation.version).success) {
    logger?.error("Not eligible: the live current package version is not a valid plain semver.", safeIdentifiers);
    return { eligible: false, reason: "current_version_invalid" };
  }
  if (!isReleaseVersionGreaterThan(intent.version, currentVersionObservation.version)) {
    logger?.error("Not eligible: the requested version does not exceed the current repository version.", safeIdentifiers);
    return { eligible: false, reason: "requested_version_not_greater", currentVersion: currentVersionObservation.version };
  }

  const releaseBranch = `release/${intent.version}`;
  const releaseBranchRef = await observeGitRef({ repository: intent.repository, ref: `heads/${releaseBranch}` });
  if (!releaseBranchRef.ok) {
    logger?.error("Not eligible: observing the release branch failed.", { ...safeIdentifiers, reason: releaseBranchRef.reason });
    return { eligible: false, reason: "release_branch_observation_error" };
  }
  if (releaseBranchRef.found) {
    const releaseBranchVersion = await observePackageVersion({ repository: intent.repository, ref: releaseBranchRef.sha });
    if (!releaseBranchVersion.ok) {
      logger?.error("Not eligible: observing the existing release branch's package version failed.", {
        ...safeIdentifiers,
        releaseBranch,
        reason: releaseBranchVersion.reason,
      });
      return { eligible: false, reason: "release_branch_version_observation_error", releaseBranch };
    }
    if (!releaseBranchVersion.found) {
      logger?.error("Not eligible: a release branch already exists but has no package.json to reconcile against.", {
        ...safeIdentifiers,
        releaseBranch,
      });
      return { eligible: false, reason: "release_branch_conflict", releaseBranch };
    }
    if (releaseBranchVersion.version === intent.version) {
      logger?.info("Already started: the release branch already carries the requested version — idempotent.", {
        ...safeIdentifiers,
        releaseBranch,
      });
      return { eligible: false, reason: "already_started", releaseBranch, headSha: releaseBranchRef.sha };
    }
    logger?.error("Not eligible: a release branch already exists with a conflicting version.", safeIdentifiers);
    return { eligible: false, reason: "release_branch_conflict", releaseBranch };
  }

  const tag = `v${intent.version}`;
  const tagRef = await observeGitRef({ repository: intent.repository, ref: `tags/${tag}` });
  if (!tagRef.ok) {
    logger?.error("Not eligible: observing the release tag failed.", { ...safeIdentifiers, reason: tagRef.reason });
    return { eligible: false, reason: "release_tag_observation_error" };
  }
  if (tagRef.found) {
    logger?.error("Not eligible: a conflicting release tag already exists.", safeIdentifiers);
    return { eligible: false, reason: "release_tag_conflict", tag };
  }

  logger?.info("Release eligible: durable intent agrees with fresh authoritative repository state.", safeIdentifiers);
  return {
    eligible: true,
    releaseIntentId,
    repository: intent.repository,
    version: intent.version,
    sourceBranch: intent.sourceBranch,
    sourceRevision: intent.sourceRevision,
  };
}
