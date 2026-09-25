import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeEligibleReleaseStart } from "./releaseStartExecution";

import type { EvaluateReleaseEligibilityForIntent } from "./releaseStartExecution";
import type { ReleaseEligibilityOutcome } from "./releaseEligibility";
import type { MaterializeRepositoryWorkspace } from "./repositoryWorkspace";
import type { RunGit, RunGitParams } from "./gitProcess";
import type { MintGithubDeliveryCredential } from "./githubAppCredential";

const RELEASE_INTENT_ID = "johnpwise__kanban-app--1.4.0";
const REPOSITORY = "johnpwise/kanban-app";
const VERSION = "1.4.0";
const SOURCE_BRANCH = "develop";
const SOURCE_REVISION = "a".repeat(40);
const RELEASE_BRANCH = "release/1.4.0";
const COMMIT_SHA = "c".repeat(40);

const ELIGIBLE_RESULT: ReleaseEligibilityOutcome = {
  eligible: true,
  releaseIntentId: RELEASE_INTENT_ID,
  repository: REPOSITORY,
  version: VERSION,
  sourceBranch: SOURCE_BRANCH,
  sourceRevision: SOURCE_REVISION,
};

function fakeEvaluateReleaseEligibility(outcome: ReleaseEligibilityOutcome): {
  evaluateReleaseEligibility: EvaluateReleaseEligibilityForIntent;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    evaluateReleaseEligibility: async (releaseIntentId) => {
      calls.push(releaseIntentId);
      return outcome;
    },
  };
}

function fakeMaterializeRepositoryWorkspace(
  behavior: { headSha?: string; reason?: "workspace_create_failed" | "clone_failed" | "checkout_failed"; gitErrorCode?: number | string | null } = {},
): { materializeRepositoryWorkspace: MaterializeRepositoryWorkspace; cleanupCallCount: () => number } {
  let cleanupCalls = 0;
  return {
    cleanupCallCount: () => cleanupCalls,
    materializeRepositoryWorkspace: async () => {
      if (behavior.reason === "workspace_create_failed") {
        return { ok: false, reason: "workspace_create_failed" };
      }
      if (behavior.reason) {
        return { ok: false, reason: behavior.reason, gitErrorCode: behavior.gitErrorCode ?? null };
      }
      return {
        ok: true,
        workspace: { path: "/tmp/fake-release-workspace", headSha: behavior.headSha ?? SOURCE_REVISION },
        cleanup: async () => {
          cleanupCalls += 1;
        },
      };
    },
  };
}

/** Drives a fully successful real-shaped runGit/mintCredential pair through every downstream composed step (branch → version files → commit → push). */
function successfulEnvironment(): { runGit: RunGit; mintCredential: MintGithubDeliveryCredential; calls: RunGitParams[] } {
  const calls: RunGitParams[] = [];
  let committed = false;
  const runGit: RunGit = async (params) => {
    calls.push(params);
    if (params.args[0] === "check-ref-format") return { ok: true, stdout: "" };
    if (params.args[0] === "checkout") return { ok: true, stdout: "" };
    if (params.args[0] === "rev-parse" && params.args[1] === "--abbrev-ref") return { ok: true, stdout: `${RELEASE_BRANCH}\n` };
    if (params.args[0] === "status") return { ok: true, stdout: " M package.json\n M package-lock.json\n" };
    if (params.args[0] === "add") return { ok: true, stdout: "" };
    if (params.args.includes("commit")) {
      committed = true;
      return { ok: true, stdout: "" };
    }
    if (params.args[0] === "rev-parse" && params.args[1] === "HEAD") {
      return { ok: true, stdout: `${committed ? COMMIT_SHA : SOURCE_REVISION}\n` };
    }
    // Parent resolution (`rev-parse <sha>^`) — the commit's direct parent is always the trusted sourceRevision.
    if (params.args[0] === "rev-parse") return { ok: true, stdout: `${SOURCE_REVISION}\n` };
    if (params.args[0] === "diff-tree") return { ok: true, stdout: "package-lock.json\npackage.json\n" };
    if (params.args[0] === "push") return { ok: true, stdout: "" };
    if (params.args[0] === "ls-remote") return { ok: true, stdout: `${COMMIT_SHA}\trefs/heads/${RELEASE_BRANCH}\n` };
    return { ok: true, stdout: "" };
  };
  const mintCredential: MintGithubDeliveryCredential = async () => ({ ok: true, token: "test-token", expiresAt: "2026-01-01T00:00:00Z" });
  return { runGit, mintCredential, calls };
}

describe("executeEligibleReleaseStart", () => {
  const realWorkspacePaths: string[] = [];

  afterEach(async () => {
    await Promise.all(realWorkspacePaths.map((path) => rm(path, { recursive: true, force: true })));
    realWorkspacePaths.length = 0;
  });

  it("evaluates eligibility fresh for the given releaseIntentId on every invocation", async () => {
    // Arrange
    const { evaluateReleaseEligibility, calls } = fakeEvaluateReleaseEligibility({ eligible: false, reason: "release_intent_not_found" });
    const { materializeRepositoryWorkspace } = fakeMaterializeRepositoryWorkspace();
    const { runGit, mintCredential } = successfulEnvironment();

    // Act
    await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace,
      runGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(calls).toEqual([RELEASE_INTENT_ID]);
  });

  it("performs no workspace mutation and returns typed not_eligible, preserving the exact eligibility reason, when not eligible", async () => {
    // Arrange
    const notEligible: ReleaseEligibilityOutcome = { eligible: false, reason: "source_revision_drift", expectedSourceRevision: "a".repeat(40), actualSourceRevision: "b".repeat(40) };
    const { evaluateReleaseEligibility } = fakeEvaluateReleaseEligibility(notEligible);
    const { materializeRepositoryWorkspace } = fakeMaterializeRepositoryWorkspace();
    let workspaceCalls = 0;
    const trackedMaterialize: MaterializeRepositoryWorkspace = async (request) => {
      workspaceCalls += 1;
      return materializeRepositoryWorkspace(request);
    };
    const { runGit, mintCredential } = successfulEnvironment();

    // Act
    const result = await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace: trackedMaterialize,
      runGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(result).toEqual({ outcome: "not_eligible", releaseIntentId: RELEASE_INTENT_ID, eligibility: notEligible });
    expect(workspaceCalls).toBe(0);
  });

  it("returns a distinct idempotent already_started outcome, with no workspace mutation, for the already-started repeat-invocation path", async () => {
    // Arrange
    const alreadyStarted: ReleaseEligibilityOutcome = { eligible: false, reason: "already_started", releaseBranch: RELEASE_BRANCH, headSha: COMMIT_SHA };
    const { evaluateReleaseEligibility } = fakeEvaluateReleaseEligibility(alreadyStarted);
    let workspaceCalls = 0;
    const trackedMaterialize: MaterializeRepositoryWorkspace = async () => {
      workspaceCalls += 1;
      return { ok: true, workspace: { path: "/tmp/x", headSha: SOURCE_REVISION }, cleanup: async () => {} };
    };
    const { runGit, mintCredential } = successfulEnvironment();

    // Act
    const result = await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace: trackedMaterialize,
      runGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(result).toEqual({ outcome: "already_started", releaseIntentId: RELEASE_INTENT_ID, releaseBranch: RELEASE_BRANCH, headSha: COMMIT_SHA });
    expect(workspaceCalls).toBe(0);
  });

  it("materialises the workspace using only the trusted repository/sourceBranch from the fresh eligibility result — never caller input", async () => {
    // Arrange
    const { evaluateReleaseEligibility } = fakeEvaluateReleaseEligibility(ELIGIBLE_RESULT);
    const requests: unknown[] = [];
    const trackedMaterialize: MaterializeRepositoryWorkspace = async (request) => {
      requests.push(request);
      return { ok: true, workspace: { path: "/tmp/fake-release-workspace", headSha: SOURCE_REVISION }, cleanup: async () => {} };
    };
    const { runGit, mintCredential } = successfulEnvironment();

    // Act
    await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace: trackedMaterialize,
      runGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(requests).toEqual([{ repository: REPOSITORY, baseBranch: SOURCE_BRANCH }]);
  });

  it("returns a safe workspace_materialization_failed outcome, without leaking stderr, when materialisation fails", async () => {
    // Arrange
    const { evaluateReleaseEligibility } = fakeEvaluateReleaseEligibility(ELIGIBLE_RESULT);
    const { materializeRepositoryWorkspace } = fakeMaterializeRepositoryWorkspace({ reason: "clone_failed", gitErrorCode: 128 });
    const { runGit, mintCredential } = successfulEnvironment();

    // Act
    const result = await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace,
      runGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(result).toEqual({
      outcome: "workspace_materialization_failed",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      reason: "clone_failed",
      gitErrorCode: 128,
    });
  });

  it("fails closed with a distinct source_revision_drift outcome — never touching release files — when workspace HEAD disagrees with the trusted sourceRevision", async () => {
    // Arrange
    const { evaluateReleaseEligibility } = fakeEvaluateReleaseEligibility(ELIGIBLE_RESULT);
    const { materializeRepositoryWorkspace, cleanupCallCount } = fakeMaterializeRepositoryWorkspace({ headSha: "f".repeat(40) });
    const { runGit, calls, mintCredential } = successfulEnvironment();

    // Act
    const result = await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace,
      runGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(result).toEqual({
      outcome: "source_revision_drift",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      expectedSourceRevision: SOURCE_REVISION,
      actualSourceRevision: "f".repeat(40),
    });
    expect(calls).toHaveLength(0);
    expect(cleanupCallCount()).toBe(1);
  });

  it("passes through a release-branch failure typed and distinct, and still cleans up the workspace", async () => {
    // Arrange
    const { evaluateReleaseEligibility } = fakeEvaluateReleaseEligibility(ELIGIBLE_RESULT);
    const { materializeRepositoryWorkspace, cleanupCallCount } = fakeMaterializeRepositoryWorkspace();
    const runGit: RunGit = async (params) => {
      if (params.args[0] === "check-ref-format") return { ok: true, stdout: "" };
      return { ok: false, stderr: "unsafe detail", code: 128 };
    };
    const { mintCredential } = successfulEnvironment();

    // Act
    const result = await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace,
      runGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(result).toEqual({
      outcome: "release_branch_failed",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      reason: "branch_creation_failed",
      gitErrorCode: 128,
    });
    expect(cleanupCallCount()).toBe(1);
  });

  it("passes through a version-write failure typed and distinct, and still cleans up the workspace", async () => {
    // Arrange
    const { evaluateReleaseEligibility } = fakeEvaluateReleaseEligibility(ELIGIBLE_RESULT);
    const { materializeRepositoryWorkspace, cleanupCallCount } = fakeMaterializeRepositoryWorkspace();
    const { runGit: baseRunGit, mintCredential } = successfulEnvironment();
    // package.json can never be read from the fake workspace path (no real fs backing it), so
    // writeReleaseVersion always reports package_json_read_failed here — proving the orchestrator
    // reaches and passes through this exact failure without needing a real filesystem.
    const result = await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace,
      runGit: baseRunGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(result).toEqual({
      outcome: "version_write_failed",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      reason: "package_json_read_failed",
    });
    expect(cleanupCallCount()).toBe(1);
  });

  it("passes through a release-commit failure typed and distinct, and still cleans up the workspace", async () => {
    // Arrange — real fs-backed workspace so the version bump genuinely succeeds and the orchestrator reaches the commit step.
    const workspacePath = await mkdtemp(join(tmpdir(), "ada-executor-release-start-commit-fail-"));
    realWorkspacePaths.push(workspacePath);
    await writeFile(join(workspacePath, "package.json"), JSON.stringify({ name: "kanban-app", version: "1.3.0" }, null, 2) + "\n");
    await writeFile(
      join(workspacePath, "package-lock.json"),
      JSON.stringify({ name: "kanban-app", version: "1.3.0", lockfileVersion: 3, packages: { "": { name: "kanban-app", version: "1.3.0" } } }, null, 2) +
        "\n",
    );
    const { evaluateReleaseEligibility } = fakeEvaluateReleaseEligibility(ELIGIBLE_RESULT);
    let cleanupCalls = 0;
    const materializeRepositoryWorkspace: MaterializeRepositoryWorkspace = async () => ({
      ok: true,
      workspace: { path: workspacePath, headSha: SOURCE_REVISION },
      cleanup: async () => {
        cleanupCalls += 1;
      },
    });
    const { runGit: baseRunGit, mintCredential } = successfulEnvironment();
    const runGit: RunGit = async (params) => {
      if (params.args[0] === "status") return { ok: true, stdout: " M package.json\n M package-lock.json\n" };
      if (params.args.includes("commit")) return { ok: false, stderr: "unsafe detail", code: 1 };
      return baseRunGit(params);
    };

    // Act
    const result = await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace,
      runGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(result).toEqual({ outcome: "release_commit_failed", releaseIntentId: RELEASE_INTENT_ID, repository: REPOSITORY, reason: "commit_failed", gitErrorCode: 1 });
    expect(cleanupCalls).toBe(1);
  });

  it("passes through a release-push failure typed and distinct, and still cleans up the workspace", async () => {
    // Arrange — real fs-backed workspace so version bump + commit genuinely succeed and the orchestrator reaches the push step.
    const workspacePath = await mkdtemp(join(tmpdir(), "ada-executor-release-start-push-fail-"));
    realWorkspacePaths.push(workspacePath);
    await writeFile(join(workspacePath, "package.json"), JSON.stringify({ name: "kanban-app", version: "1.3.0" }, null, 2) + "\n");
    await writeFile(
      join(workspacePath, "package-lock.json"),
      JSON.stringify({ name: "kanban-app", version: "1.3.0", lockfileVersion: 3, packages: { "": { name: "kanban-app", version: "1.3.0" } } }, null, 2) +
        "\n",
    );
    const { evaluateReleaseEligibility } = fakeEvaluateReleaseEligibility(ELIGIBLE_RESULT);
    let cleanupCalls = 0;
    const materializeRepositoryWorkspace: MaterializeRepositoryWorkspace = async () => ({
      ok: true,
      workspace: { path: workspacePath, headSha: SOURCE_REVISION },
      cleanup: async () => {
        cleanupCalls += 1;
      },
    });
    const { runGit: baseRunGit, mintCredential } = successfulEnvironment();
    const runGit: RunGit = async (params) => {
      if (params.args[0] === "push") return { ok: false, stderr: "unsafe detail", code: 1 };
      return baseRunGit(params);
    };

    // Act
    const result = await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace,
      runGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(result).toEqual({ outcome: "release_push_failed", releaseIntentId: RELEASE_INTENT_ID, repository: REPOSITORY, reason: "push_failed", gitErrorCode: 1 });
    expect(cleanupCalls).toBe(1);
  });

  it("never includes raw stderr, credential tokens, or the workspace path in any failure outcome", async () => {
    // Arrange
    const { evaluateReleaseEligibility } = fakeEvaluateReleaseEligibility(ELIGIBLE_RESULT);
    const { materializeRepositoryWorkspace } = fakeMaterializeRepositoryWorkspace();
    const runGit: RunGit = async () => ({ ok: false, stderr: "fatal: unsafe stderr detail", code: 1 });
    const mintCredential: MintGithubDeliveryCredential = async () => ({ ok: true, token: "should-never-leak", expiresAt: "2026-01-01T00:00:00Z" });

    // Act
    const result = await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace,
      runGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(JSON.stringify(result)).not.toContain("unsafe stderr detail");
    expect(JSON.stringify(result)).not.toContain("should-never-leak");
    expect(JSON.stringify(result)).not.toContain("/tmp/fake-release-workspace");
  });

  it("completes the full composed happy path — branch, version bump, commit, push — cleaning up the workspace afterward", async () => {
    // Arrange — real fs-backed workspace (runGit stays fully faked; only the JSON version files are real) so writeReleaseVersion/verifyReleaseVersion can genuinely succeed.
    const workspacePath = await mkdtemp(join(tmpdir(), "ada-executor-release-start-"));
    realWorkspacePaths.push(workspacePath);
    await writeFile(join(workspacePath, "package.json"), JSON.stringify({ name: "kanban-app", version: "1.3.0" }, null, 2) + "\n");
    await writeFile(
      join(workspacePath, "package-lock.json"),
      JSON.stringify({ name: "kanban-app", version: "1.3.0", lockfileVersion: 3, packages: { "": { name: "kanban-app", version: "1.3.0" } } }, null, 2) +
        "\n",
    );
    const { evaluateReleaseEligibility } = fakeEvaluateReleaseEligibility(ELIGIBLE_RESULT);
    let cleanupCalls = 0;
    const materializeRepositoryWorkspace: MaterializeRepositoryWorkspace = async () => ({
      ok: true,
      workspace: { path: workspacePath, headSha: SOURCE_REVISION },
      cleanup: async () => {
        cleanupCalls += 1;
      },
    });
    const { runGit, mintCredential } = successfulEnvironment();

    // Act
    const result = await executeEligibleReleaseStart({
      releaseIntentId: RELEASE_INTENT_ID,
      evaluateReleaseEligibility,
      materializeRepositoryWorkspace,
      runGit,
      env: {},
      mintCredential,
    });

    // Assert
    expect(result).toEqual({
      outcome: "started",
      releaseIntentId: RELEASE_INTENT_ID,
      repository: REPOSITORY,
      version: VERSION,
      releaseBranch: RELEASE_BRANCH,
      commitSha: COMMIT_SHA,
      remoteSha: COMMIT_SHA,
    });
    expect(cleanupCalls).toBe(1);
  });
});
