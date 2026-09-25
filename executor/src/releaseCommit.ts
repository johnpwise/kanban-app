import { createGitCommit, resolveGitCommitSha, verifyGitCommitTopology } from "./gitCommitOperations";

import type { RunGit } from "./gitProcess";

/**
 * Fixed, ADA-controlled commit identity for release-start commits — a distinct identity from the
 * ADA delivery commit's, so a release-start commit is never mistaken for a delivery commit by
 * author alone. Set via invocation-scoped `-c` flags (see `createGitCommit`), never written to
 * persistent/global Git config.
 */
const RELEASE_COMMIT_AUTHOR_NAME = "ADA Release Engine";
const RELEASE_COMMIT_AUTHOR_EMAIL = "ada-release-engine@ada.local";

/** The only two files a release-start commit is ever allowed to touch. */
const RELEASE_VERSION_FILES = ["package.json", "package-lock.json"] as const;

/**
 * Deterministic release-start commit message for a trusted version: the same `version` always
 * derives the same message. Takes only the exact trusted `version` — never task text, prompt, or
 * repository content.
 */
export function deriveReleaseCommitMessage(version: string): string {
  return `chore(release): prepare v${version}`;
}

export interface VerifyReleaseWorkingTreeDeltaRequest {
  /** The still-live materialised workspace path, immediately after the version files were written. */
  workspacePath: string;
}

export type VerifyReleaseWorkingTreeDeltaOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "unexpected_release_delta";
      /** The unexpected paths only — never the full `git status` output. */
      paths: string[];
    }
  | {
      ok: false;
      reason: "status_inspection_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface VerifyReleaseWorkingTreeDeltaParams extends VerifyReleaseWorkingTreeDeltaRequest {
  runGit: RunGit;
}

function parsePorcelainPaths(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).trim());
}

/**
 * Confirms the working tree's *entire* modified/untracked delta is exactly the fixed release
 * version files — no more, no less — via `git status --porcelain=v1`, before anything is staged.
 * A coding-agent-style change slipping into the workspace, or a version write touching an
 * unexpected file, is reported as a safe failure rather than silently staged and committed.
 */
export async function verifyReleaseWorkingTreeDelta({
  workspacePath,
  runGit,
}: VerifyReleaseWorkingTreeDeltaParams): Promise<VerifyReleaseWorkingTreeDeltaOutcome> {
  const outcome = await runGit({ args: ["status", "--porcelain=v1"], cwd: workspacePath });
  if (!outcome.ok) {
    return { ok: false, reason: "status_inspection_failed", gitErrorCode: outcome.code };
  }
  const paths = parsePorcelainPaths(outcome.stdout);
  const unexpected = paths.filter((path) => !(RELEASE_VERSION_FILES as readonly string[]).includes(path));
  if (unexpected.length > 0) {
    return { ok: false, reason: "unexpected_release_delta", paths: unexpected };
  }
  return { ok: true };
}

export interface StageReleaseFilesRequest {
  /** The still-live materialised workspace path, with a working-tree delta already verified as exactly the release version files. */
  workspacePath: string;
}

export type StageReleaseFilesOutcome =
  | { ok: true }
  | {
      ok: false;
      reason: "staging_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    };

export interface StageReleaseFilesParams extends StageReleaseFilesRequest {
  runGit: RunGit;
}

/**
 * Stages exactly the two fixed release version files by explicit pathspec — never `git add -A`.
 * The `--` terminates option parsing before the pathspecs, so a filename can never be misread as a
 * git flag.
 */
export async function stageReleaseFiles({ workspacePath, runGit }: StageReleaseFilesParams): Promise<StageReleaseFilesOutcome> {
  const outcome = await runGit({ args: ["add", "--", ...RELEASE_VERSION_FILES], cwd: workspacePath });
  if (!outcome.ok) {
    return { ok: false, reason: "staging_failed", gitErrorCode: outcome.code };
  }
  return { ok: true };
}

export interface EnsureReleaseCommitRequest {
  /** The still-live materialised workspace path, checked out on the verified release branch with the version files already written. */
  workspacePath: string;
  /** The exact trusted version from a fresh eligibility result. */
  version: string;
  /** The verified release branch the commit must remain checked out on. */
  expectedBranch: string;
  /** The exact trusted `sourceRevision` the commit must be a direct child of. */
  expectedParentSha: string;
}

export type EnsureReleaseCommitOutcome =
  | { ok: true; commitSha: string }
  | { ok: false; reason: "unexpected_release_delta"; paths: string[] }
  | { ok: false; reason: "working_tree_inspection_failed"; gitErrorCode: number | string | null }
  | { ok: false; reason: "staging_failed"; gitErrorCode: number | string | null }
  | { ok: false; reason: "commit_failed"; gitErrorCode: number | string | null }
  | { ok: false; reason: "resolution_failed"; gitErrorCode: number | string | null }
  | { ok: false; reason: "head_mismatch"; expectedCommitSha: string; actualHeadSha: string }
  | { ok: false; reason: "branch_mismatch"; expectedBranch: string; actualBranch: string }
  | { ok: false; reason: "parent_mismatch"; expectedParentSha: string; actualParentSha: string }
  | {
      ok: false;
      reason: "verification_inspection_failed";
      stage: "resolve_head" | "resolve_branch" | "resolve_parent";
      gitErrorCode: number | string | null;
    }
  | { ok: false; reason: "commit_delta_mismatch"; paths: string[] }
  | { ok: false; reason: "commit_delta_inspection_failed"; gitErrorCode: number | string | null };

export interface EnsureReleaseCommitParams extends EnsureReleaseCommitRequest {
  runGit: RunGit;
}

/**
 * Verifies the working tree holds exactly the intended release-version delta, stages only those
 * files, creates the single deterministic release-start commit, resolves its SHA, independently
 * verifies the post-commit topology (`HEAD`/branch/parent), and — never trusting the commit's own
 * success alone — independently re-lists the committed files via `git diff-tree` to confirm the
 * commit itself contains exactly the release version files and nothing else. Each sub-step's
 * failure short-circuits the next.
 */
export async function ensureReleaseCommit({
  workspacePath,
  version,
  expectedBranch,
  expectedParentSha,
  runGit,
}: EnsureReleaseCommitParams): Promise<EnsureReleaseCommitOutcome> {
  const deltaOutcome = await verifyReleaseWorkingTreeDelta({ workspacePath, runGit });
  if (!deltaOutcome.ok) {
    if (deltaOutcome.reason === "unexpected_release_delta") {
      return deltaOutcome;
    }
    return { ok: false, reason: "working_tree_inspection_failed", gitErrorCode: deltaOutcome.gitErrorCode };
  }

  const stageOutcome = await stageReleaseFiles({ workspacePath, runGit });
  if (!stageOutcome.ok) {
    return { ok: false, reason: "staging_failed", gitErrorCode: stageOutcome.gitErrorCode };
  }

  const message = deriveReleaseCommitMessage(version);
  const commitOutcome = await createGitCommit({
    workspacePath,
    message,
    authorName: RELEASE_COMMIT_AUTHOR_NAME,
    authorEmail: RELEASE_COMMIT_AUTHOR_EMAIL,
    runGit,
  });
  if (!commitOutcome.ok) {
    return { ok: false, reason: "commit_failed", gitErrorCode: commitOutcome.gitErrorCode };
  }

  const resolveOutcome = await resolveGitCommitSha({ workspacePath, runGit });
  if (!resolveOutcome.ok) {
    return { ok: false, reason: "resolution_failed", gitErrorCode: resolveOutcome.gitErrorCode };
  }

  const topologyOutcome = await verifyGitCommitTopology({
    workspacePath,
    expectedCommitSha: resolveOutcome.commitSha,
    expectedBranch,
    expectedParentSha,
    runGit,
  });
  if (!topologyOutcome.ok) {
    if (topologyOutcome.reason === "inspection_failed") {
      return {
        ok: false,
        reason: "verification_inspection_failed",
        stage: topologyOutcome.stage,
        gitErrorCode: topologyOutcome.gitErrorCode,
      };
    }
    return topologyOutcome;
  }

  const deltaCheckOutcome = await runGit({
    args: ["diff-tree", "--no-commit-id", "--name-only", "-r", resolveOutcome.commitSha],
    cwd: workspacePath,
  });
  if (!deltaCheckOutcome.ok) {
    return { ok: false, reason: "commit_delta_inspection_failed", gitErrorCode: deltaCheckOutcome.code };
  }
  const committedPaths = deltaCheckOutcome.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort();
  const expectedPaths = [...RELEASE_VERSION_FILES].sort();
  if (JSON.stringify(committedPaths) !== JSON.stringify(expectedPaths)) {
    return { ok: false, reason: "commit_delta_mismatch", paths: committedPaths };
  }

  return { ok: true, commitSha: resolveOutcome.commitSha };
}
