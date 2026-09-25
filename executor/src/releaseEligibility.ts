import { z } from "zod";

import { deriveReleaseCommitMessage } from "./releaseCommit";
import { deepEqualJson } from "./releaseVersionMutation";
import { parseReleaseIntentDocument, releaseVersionSchema, isReleaseVersionGreaterThan } from "./schemas/releaseIntentDocument";

import type { ExecutorLogger } from "./runExecutor";
import type { ReleaseIntentRepository } from "./releaseIntentRepository";
import type { ObserveCommit, ObserveFileContent, ObserveGitRefSha, ObservePackageVersion } from "./releaseRepositoryObservation";

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
  /** Used only for already-started recovery reconciliation, to independently inspect the existing
   * release branch's head commit (message/parent/changed files). */
  observeCommit: ObserveCommit;
  /** Used only for already-started recovery reconciliation, to independently re-derive
   * `package.json`/`package-lock.json` content at both the trusted `sourceRevision` and the
   * existing release branch head, for a semantic delta comparison. */
  observeFileContent: ObserveFileContent;
  logger?: ExecutorLogger;
}

/** Deliberately tolerant, mirroring `releaseVersionMutation.ts`'s own lockfile shape — only the
 * fields this reconciliation reads are asserted. */
const recoveryLockfileShape = z.looseObject({
  version: z.string(),
  packages: z.looseObject({ "": z.looseObject({ version: z.string() }) }),
});

/** Alphabetically pre-sorted (distinct from `releaseCommit.ts`'s own unsorted, unexported constant
 * of the same two files) so it can be compared directly against a sorted observed file list. */
const EXPECTED_RECOVERY_CHANGED_FILES = ["package-lock.json", "package.json"];

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
  /** Only ever reported once a pre-existing `release/<version>` branch has been fully reconciled
   * against the persisted release intent — a superficial branch/package-version match alone never
   * reaches this reason; see the recovery reasons below. */
  | {
      eligible: false;
      reason: "already_started";
      releaseIntentId: string;
      repository: string;
      version: string;
      sourceBranch: string;
      sourceRevision: string;
      releaseBranch: string;
      /** The independently-recovered, authoritative release-start commit SHA — trusted crash-recovery identity a durable persistence step may safely record. */
      releaseCommitSha: string;
    }
  | { eligible: false; reason: "release_branch_recovery_commit_observation_error"; releaseBranch: string }
  | { eligible: false; reason: "release_branch_recovery_parent_mismatch"; releaseBranch: string }
  | { eligible: false; reason: "release_branch_recovery_message_mismatch"; releaseBranch: string }
  | { eligible: false; reason: "release_branch_recovery_changed_files_mismatch"; releaseBranch: string }
  | { eligible: false; reason: "release_branch_recovery_content_observation_error"; releaseBranch: string }
  | { eligible: false; reason: "release_branch_recovery_lockfile_version_mismatch"; releaseBranch: string }
  | { eligible: false; reason: "release_branch_recovery_unrelated_change"; releaseBranch: string }
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
 *    `release/<version>` branch whose `package.json` version does not match the requested version is
 *    a hard `release_branch_conflict`; a version match alone is only a *candidate* for recovery — it
 *    is never sufficient evidence on its own. A pre-existing `v<version>` tag is always a hard
 *    `release_tag_conflict` — a tag means the release already completed, so unlike the release
 *    branch there is no idempotent-match case.
 *
 * A version-matching pre-existing release branch is then independently reconciled against the
 * persisted release intent before it can be trusted as crash-recovery evidence: its head commit's
 * direct parent must be exactly `sourceRevision`, its message must be the deterministic
 * `chore(release): prepare v<version>`, it must have changed exactly `package.json` and
 * `package-lock.json`, the lockfile's root version must match the requested version, and a semantic
 * diff of both files against their content at `sourceRevision` must show only the version field(s)
 * changed. Any disagreement fails closed with its own distinct `release_branch_recovery_*` reason —
 * a manually created or otherwise conflicting branch that merely happens to carry the right package
 * version is never mistaken for ADA's own guarded release-start result. Only full agreement yields
 * `already_started`, now carrying the full trusted identity (`releaseIntentId`, `repository`,
 * `version`, `sourceBranch`, `sourceRevision`, `releaseBranch`, `releaseCommitSha`) a durable
 * persistence step may safely record.
 *
 * Read-only end-to-end: no Firestore write, no GitHub mutation, no branch repair/rebase/reset/replace
 * on any disagreement. A later release-start controller must re-run this evaluation immediately
 * before mutating — this result is never persisted as a standing "approved forever" token.
 */
export async function evaluateReleaseEligibility(
  params: EvaluateReleaseEligibilityParams,
): Promise<ReleaseEligibilityOutcome> {
  const {
    releaseIntentId,
    expectedRepository,
    expectedSourceBranch,
    repository,
    observeGitRef,
    observePackageVersion,
    observeCommit,
    observeFileContent,
    logger,
  } = params;

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
      const releaseCommitSha = releaseBranchRef.sha;
      const recoveryIdentifiers = { ...safeIdentifiers, releaseBranch, releaseCommitSha };

      const commitObservation = await observeCommit({ repository: intent.repository, sha: releaseCommitSha });
      if (!commitObservation.ok || !commitObservation.found) {
        logger?.error("Already-started recovery failed: observing the existing release branch's head commit failed.", recoveryIdentifiers);
        return { eligible: false, reason: "release_branch_recovery_commit_observation_error", releaseBranch };
      }
      const { commit } = commitObservation;

      if (commit.parentShas.length !== 1 || commit.parentShas[0] !== intent.sourceRevision) {
        logger?.error("Already-started recovery failed: the existing release commit's parent does not match the trusted source revision.", recoveryIdentifiers);
        return { eligible: false, reason: "release_branch_recovery_parent_mismatch", releaseBranch };
      }

      if (commit.message !== deriveReleaseCommitMessage(intent.version)) {
        logger?.error("Already-started recovery failed: the existing release commit's message is not the deterministic release-start message.", recoveryIdentifiers);
        return { eligible: false, reason: "release_branch_recovery_message_mismatch", releaseBranch };
      }

      const actualChangedFiles = [...commit.changedFiles].sort();
      if (JSON.stringify(actualChangedFiles) !== JSON.stringify(EXPECTED_RECOVERY_CHANGED_FILES)) {
        logger?.error("Already-started recovery failed: the existing release commit changed an unexpected set of files.", recoveryIdentifiers);
        return { eligible: false, reason: "release_branch_recovery_changed_files_mismatch", releaseBranch };
      }

      const [beforePackageJson, beforeLockfile, afterPackageJson, afterLockfile] = await Promise.all([
        observeFileContent({ repository: intent.repository, ref: intent.sourceRevision, path: "package.json" }),
        observeFileContent({ repository: intent.repository, ref: intent.sourceRevision, path: "package-lock.json" }),
        observeFileContent({ repository: intent.repository, ref: releaseCommitSha, path: "package.json" }),
        observeFileContent({ repository: intent.repository, ref: releaseCommitSha, path: "package-lock.json" }),
      ]);
      const contentObservations = [beforePackageJson, beforeLockfile, afterPackageJson, afterLockfile];
      if (contentObservations.some((observation) => !observation.ok || !observation.found)) {
        logger?.error("Already-started recovery failed: observing package.json/package-lock.json content failed.", recoveryIdentifiers);
        return { eligible: false, reason: "release_branch_recovery_content_observation_error", releaseBranch };
      }
      const foundContentObservations = contentObservations as Extract<Awaited<ReturnType<ObserveFileContent>>, { ok: true; found: true }>[];
      const [beforePackageJsonContent, beforeLockfileContent, afterPackageJsonContent, afterLockfileContent] = foundContentObservations;

      let beforePackageJsonParsed: unknown;
      let beforeLockfileParsed: unknown;
      let afterPackageJsonParsed: unknown;
      let afterLockfileParsed: unknown;
      try {
        beforePackageJsonParsed = JSON.parse(beforePackageJsonContent.content);
        beforeLockfileParsed = JSON.parse(beforeLockfileContent.content);
        afterPackageJsonParsed = JSON.parse(afterPackageJsonContent.content);
        afterLockfileParsed = JSON.parse(afterLockfileContent.content);
      } catch {
        logger?.error("Already-started recovery failed: package.json/package-lock.json content is not valid JSON.", recoveryIdentifiers);
        return { eligible: false, reason: "release_branch_recovery_content_observation_error", releaseBranch };
      }

      const afterLockfileShape = recoveryLockfileShape.safeParse(afterLockfileParsed);
      if (
        !afterLockfileShape.success ||
        afterLockfileShape.data.version !== intent.version ||
        afterLockfileShape.data.packages[""].version !== intent.version
      ) {
        logger?.error("Already-started recovery failed: the existing release branch's lockfile root version does not match the requested version.", recoveryIdentifiers);
        return { eligible: false, reason: "release_branch_recovery_lockfile_version_mismatch", releaseBranch };
      }

      const expectedAfterPackageJson = {
        ...(JSON.parse(JSON.stringify(beforePackageJsonParsed)) as Record<string, unknown>),
        version: intent.version,
      };
      if (!deepEqualJson(afterPackageJsonParsed, expectedAfterPackageJson)) {
        logger?.error("Already-started recovery failed: package.json changed an unrelated field beyond the version bump.", recoveryIdentifiers);
        return { eligible: false, reason: "release_branch_recovery_unrelated_change", releaseBranch };
      }

      const beforeLockfileShape = z.looseObject({ packages: z.looseObject({ "": z.looseObject({}) }) }).safeParse(beforeLockfileParsed);
      if (!beforeLockfileShape.success) {
        logger?.error(
          "Already-started recovery failed: the trusted source revision's package-lock.json does not have the expected shape.",
          recoveryIdentifiers,
        );
        return { eligible: false, reason: "release_branch_recovery_content_observation_error", releaseBranch };
      }
      const beforeLockfileRecord = beforeLockfileParsed as { packages: Record<string, Record<string, unknown>> };
      const expectedAfterLockfile = {
        ...(JSON.parse(JSON.stringify(beforeLockfileParsed)) as Record<string, unknown>),
        version: intent.version,
        packages: {
          ...(JSON.parse(JSON.stringify(beforeLockfileRecord.packages)) as Record<string, Record<string, unknown>>),
          "": { ...(JSON.parse(JSON.stringify(beforeLockfileRecord.packages[""])) as Record<string, unknown>), version: intent.version },
        },
      };
      if (!deepEqualJson(afterLockfileParsed, expectedAfterLockfile)) {
        logger?.error("Already-started recovery failed: package-lock.json changed an unrelated field beyond the version bump.", recoveryIdentifiers);
        return { eligible: false, reason: "release_branch_recovery_unrelated_change", releaseBranch };
      }

      logger?.info(
        "Already started: existing release branch independently reconciled against the persisted release intent — trusted recovery.",
        recoveryIdentifiers,
      );
      return {
        eligible: false,
        reason: "already_started",
        releaseIntentId,
        repository: intent.repository,
        version: intent.version,
        sourceBranch: intent.sourceBranch,
        sourceRevision: intent.sourceRevision,
        releaseBranch,
        releaseCommitSha,
      };
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
