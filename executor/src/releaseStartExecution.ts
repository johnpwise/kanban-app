import { ensureReleaseBranch } from "./releaseBranch";
import { ensureReleaseCommit } from "./releaseCommit";
import { ensureReleaseStartPush } from "./releasePush";
import { writeReleaseVersion, verifyReleaseVersion } from "./releaseVersionMutation";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";
import type { RunGit } from "./gitProcess";
import type { EnsureReleaseBranchOutcome } from "./releaseBranch";
import type { EnsureReleaseCommitOutcome } from "./releaseCommit";
import type { EnsureReleaseStartPushOutcome } from "./releasePush";
import type { VerifyReleaseVersionOutcome, WriteReleaseVersionOutcome } from "./releaseVersionMutation";
import type { ReleaseEligibilityOutcome } from "./releaseEligibility";
import type { ExecutorLogger } from "./runExecutor";
import type { MaterializeRepositoryWorkspace, MaterializeRepositoryWorkspaceOutcome } from "./repositoryWorkspace";

/** Excludes `already_started` — that reason is special-cased into its own idempotent outcome before this branch is ever reached. */
type NotEligibleOutcome = Exclude<Extract<ReleaseEligibilityOutcome, { eligible: false }>, { reason: "already_started" }>;
type WorkspaceFailure = Omit<Exclude<MaterializeRepositoryWorkspaceOutcome, { ok: true }>, "ok">;
type ReleaseBranchFailure = Omit<Exclude<EnsureReleaseBranchOutcome, { ok: true }>, "ok">;
type VersionWriteFailure = Omit<Exclude<WriteReleaseVersionOutcome, { ok: true }>, "ok">;
type VersionVerifyFailure = Omit<Exclude<VerifyReleaseVersionOutcome, { ok: true }>, "ok">;
type ReleaseCommitFailure = Omit<Exclude<EnsureReleaseCommitOutcome, { ok: true }>, "ok">;
type ReleasePushFailure = Omit<Exclude<EnsureReleaseStartPushOutcome, { ok: true }>, "ok">;

/** A composition-bound closure over `evaluateReleaseEligibility` — `expectedRepository`,
 * `expectedSourceBranch`, `repository`, `observeGitRef`, `observePackageVersion`, and `logger` are
 * bound once by the caller (a composition root), mirroring `EvaluateMergeEligibilityForRun`; only
 * `releaseIntentId` is supplied per call. */
export type EvaluateReleaseEligibilityForIntent = (releaseIntentId: string) => Promise<ReleaseEligibilityOutcome>;

export interface ExecuteEligibleReleaseStartParams {
  releaseIntentId: string;
  /** Re-run fresh, immediately before any mutation attempt — never a cached/prior eligibility
   * result. A previous eligibility result must never become a standing release-start approval. */
  evaluateReleaseEligibility: EvaluateReleaseEligibilityForIntent;
  materializeRepositoryWorkspace: MaterializeRepositoryWorkspace;
  runGit: RunGit;
  /** Supplies `PATH`/`HOME` for the scoped push env — never read from `process.env` directly here. */
  env: Record<string, string | undefined>;
  mintCredential: MintGithubDeliveryCredential;
  logger?: ExecutorLogger;
}

export type ExecuteEligibleReleaseStartOutcome =
  | {
      outcome: "started";
      releaseIntentId: string;
      repository: string;
      version: string;
      sourceBranch: string;
      sourceRevision: string;
      releaseBranch: string;
      /** The verified local release-start commit that was pushed — distinct from `remoteSha` (independently re-resolved on GitHub). */
      commitSha: string;
      remoteSha: string;
    }
  /** Passes through the exact trusted recovered identity `evaluateReleaseEligibility`'s own
   * (strengthened) `already_started` reason carries — never inventing or independently re-deriving
   * any field here. A durable persistence step can treat this identically to `started` for identity
   * purposes (using `releaseCommitSha` in place of `commitSha`/`remoteSha`). */
  | {
      outcome: "already_started";
      releaseIntentId: string;
      repository: string;
      version: string;
      sourceBranch: string;
      sourceRevision: string;
      releaseBranch: string;
      releaseCommitSha: string;
    }
  | { outcome: "not_eligible"; releaseIntentId: string; eligibility: NotEligibleOutcome }
  | ({ outcome: "workspace_materialization_failed"; releaseIntentId: string; repository: string } & WorkspaceFailure)
  | {
      outcome: "source_revision_drift";
      releaseIntentId: string;
      repository: string;
      /** Safe git identifiers only — the trusted sourceRevision and what the freshly materialised workspace actually resolved to. */
      expectedSourceRevision: string;
      actualSourceRevision: string;
    }
  | ({ outcome: "release_branch_failed"; releaseIntentId: string; repository: string } & ReleaseBranchFailure)
  | ({ outcome: "version_write_failed"; releaseIntentId: string; repository: string } & VersionWriteFailure)
  | ({ outcome: "version_verification_failed"; releaseIntentId: string; repository: string } & VersionVerifyFailure)
  | ({ outcome: "release_commit_failed"; releaseIntentId: string; repository: string } & ReleaseCommitFailure)
  | ({ outcome: "release_push_failed"; releaseIntentId: string; repository: string } & ReleasePushFailure);

/**
 * Attempts exactly one guarded release-start mutation for the exact durable `releaseIntentId`
 * freshly proves eligible — the orchestration boundary above `ensureReleaseBranch` /
 * `writeReleaseVersion` / `ensureReleaseCommit` / `ensureReleaseStartPush`. Accepts only
 * `releaseIntentId` plus injected dependencies: the caller can never independently supply
 * `repository` / `version` / `sourceRevision` — those are taken solely from the fresh
 * `evaluateReleaseEligibility(...)` result, so a stale or forged identity can never steer the
 * mutation.
 *
 * `evaluateReleaseEligibility` is always re-run at the start of this call, never reused from an
 * earlier check. An ineligible result performs no mutation. `already_started` is special-cased to
 * a distinct idempotent outcome — live GitHub state is authoritative for whether the release
 * already started — rather than a generic `not_eligible` failure, so a repeat invocation after a
 * prior successful start converges safely.
 *
 * Once eligible, the workspace is materialised at the trusted `sourceBranch` and its resulting
 * `HEAD` is independently compared against the trusted `sourceRevision` *before* any branch is
 * created: a mismatch (the source moved between eligibility and materialisation) fails closed as
 * `source_revision_drift` and is never silently repaired or rebased onto the newer revision. Every
 * downstream step's typed failure is passed through verbatim under a distinct `outcome`. The
 * ephemeral workspace is cleaned up on every terminal path once it exists, success or failure — a
 * successfully pushed remote release branch is never deleted by cleanup, since cleanup only ever
 * touches the local ephemeral workspace.
 */
/** A composition-bound closure over `executeEligibleReleaseStart` — every other param is bound once
 * by the caller (a composition root), mirroring `ExecuteEligibleDeliveryMergeForRun`; only
 * `releaseIntentId` is supplied per call. Used by `releaseStartCompletionController.ts`. */
export type ExecuteEligibleReleaseStartForIntent = (releaseIntentId: string) => Promise<ExecuteEligibleReleaseStartOutcome>;

export async function executeEligibleReleaseStart({
  releaseIntentId,
  evaluateReleaseEligibility,
  materializeRepositoryWorkspace,
  runGit,
  env,
  mintCredential,
  logger,
}: ExecuteEligibleReleaseStartParams): Promise<ExecuteEligibleReleaseStartOutcome> {
  const eligibility = await evaluateReleaseEligibility(releaseIntentId);

  if (!eligibility.eligible) {
    if (eligibility.reason === "already_started") {
      const { repository, version, sourceBranch, sourceRevision, releaseBranch, releaseCommitSha } = eligibility;
      logger?.info("Release start already completed: the release branch already carries the requested version.", {
        releaseIntentId,
        releaseBranch,
      });
      return { outcome: "already_started", releaseIntentId, repository, version, sourceBranch, sourceRevision, releaseBranch, releaseCommitSha };
    }
    logger?.error("Release start refused: the release intent is not currently eligible.", { releaseIntentId, reason: eligibility.reason });
    return { outcome: "not_eligible", releaseIntentId, eligibility };
  }

  const { repository, version, sourceBranch, sourceRevision } = eligibility;
  const safeIdentifiers = { releaseIntentId, repository, version };

  const workspaceOutcome = await materializeRepositoryWorkspace({ repository, baseBranch: sourceBranch });
  if (!workspaceOutcome.ok) {
    logger?.error("Release start failed: workspace materialisation failed.", { ...safeIdentifiers, reason: workspaceOutcome.reason });
    const { ok: _ok, ...failure } = workspaceOutcome;
    void _ok;
    return { outcome: "workspace_materialization_failed", releaseIntentId, repository, ...failure };
  }

  const { workspace, cleanup } = workspaceOutcome;

  try {
    if (workspace.headSha !== sourceRevision) {
      logger?.error("Release start failed: the source branch moved between eligibility and workspace materialisation.", safeIdentifiers);
      return {
        outcome: "source_revision_drift",
        releaseIntentId,
        repository,
        expectedSourceRevision: sourceRevision,
        actualSourceRevision: workspace.headSha,
      };
    }

    const branchOutcome = await ensureReleaseBranch({
      workspacePath: workspace.path,
      version,
      expectedHeadSha: sourceRevision,
      runGit,
    });
    if (!branchOutcome.ok) {
      logger?.error("Release start failed: release branch creation/verification failed.", { ...safeIdentifiers, reason: branchOutcome.reason });
      const { ok: _ok, ...failure } = branchOutcome;
      void _ok;
      return { outcome: "release_branch_failed", releaseIntentId, repository, ...failure };
    }
    const releaseBranch = branchOutcome.branchName;

    const writeOutcome = await writeReleaseVersion({ workspacePath: workspace.path, version });
    if (!writeOutcome.ok) {
      logger?.error("Release start failed: writing the release version failed.", { ...safeIdentifiers, reason: writeOutcome.reason });
      const { ok: _ok, ...failure } = writeOutcome;
      void _ok;
      return { outcome: "version_write_failed", releaseIntentId, repository, ...failure };
    }

    const verifyVersionOutcome = await verifyReleaseVersion({
      workspacePath: workspace.path,
      version,
      originalPackageJson: writeOutcome.originalPackageJson,
      originalLockfile: writeOutcome.originalLockfile,
    });
    if (!verifyVersionOutcome.ok) {
      logger?.error("Release start failed: verifying the release version failed.", { ...safeIdentifiers, reason: verifyVersionOutcome.reason });
      const { ok: _ok, ...failure } = verifyVersionOutcome;
      void _ok;
      return { outcome: "version_verification_failed", releaseIntentId, repository, ...failure };
    }

    const commitOutcome = await ensureReleaseCommit({
      workspacePath: workspace.path,
      version,
      expectedBranch: releaseBranch,
      expectedParentSha: sourceRevision,
      runGit,
    });
    if (!commitOutcome.ok) {
      logger?.error("Release start failed: creating/verifying the release commit failed.", { ...safeIdentifiers, reason: commitOutcome.reason });
      const { ok: _ok, ...failure } = commitOutcome;
      void _ok;
      return { outcome: "release_commit_failed", releaseIntentId, repository, ...failure };
    }

    const pushOutcome = await ensureReleaseStartPush({
      workspacePath: workspace.path,
      repository,
      releaseBranch,
      releaseCommitSha: commitOutcome.commitSha,
      env,
      runGit,
      mintCredential,
    });
    if (!pushOutcome.ok) {
      logger?.error("Release start failed: publishing the release commit failed.", { ...safeIdentifiers, reason: pushOutcome.reason });
      const { ok: _ok, ...failure } = pushOutcome;
      void _ok;
      return { outcome: "release_push_failed", releaseIntentId, repository, ...failure };
    }

    logger?.info("Release start succeeded: the release branch was published with the verified version-bump commit.", {
      ...safeIdentifiers,
      releaseBranch,
      commitSha: commitOutcome.commitSha,
    });
    return {
      outcome: "started",
      releaseIntentId,
      repository,
      version,
      sourceBranch,
      sourceRevision,
      releaseBranch,
      commitSha: commitOutcome.commitSha,
      remoteSha: pushOutcome.remoteSha,
    };
  } finally {
    try {
      await cleanup();
    } catch {
      // Cleanup failure must never surface repository content or secret-bearing detail; best-effort only.
    }
  }
}
