import { describe, expect, it } from "vitest";

import { verifyGitIntegrity } from "./gitIntegrityVerification";

import type { RunGit } from "./gitProcess";

const EXPECTED_HEAD_SHA = "a".repeat(40);
const EXPECTED_BRANCH = "develop";

function fakeRunGit(
  responses: { headSha?: { ok?: boolean; stdout?: string; code?: number | string | null } } & {
    branch?: { ok?: boolean; stdout?: string; code?: number | string | null };
  },
): { runGit: RunGit; calls: { args: string[]; cwd?: string }[] } {
  const calls: { args: string[]; cwd?: string }[] = [];
  const runGit: RunGit = async (params) => {
    calls.push(params);
    if (params.args[0] === "rev-parse" && params.args[1] === "HEAD") {
      const behavior = responses.headSha ?? {};
      if (behavior.ok === false) {
        return { ok: false, stderr: "fatal: unsafe stderr detail that must never be logged", code: behavior.code ?? 128 };
      }
      return { ok: true, stdout: behavior.stdout ?? `${EXPECTED_HEAD_SHA}\n` };
    }
    const behavior = responses.branch ?? {};
    if (behavior.ok === false) {
      return { ok: false, stderr: "fatal: unsafe stderr detail that must never be logged", code: behavior.code ?? 128 };
    }
    return { ok: true, stdout: behavior.stdout ?? `${EXPECTED_BRANCH}\n` };
  };
  return { runGit, calls };
}

describe("verifyGitIntegrity", () => {
  it("reports verified when HEAD and the checked-out branch both match", async () => {
    // Arrange
    const { runGit } = fakeRunGit({});

    // Act
    const outcome = await verifyGitIntegrity({
      workspacePath: "/workspace",
      expectedHeadSha: EXPECTED_HEAD_SHA,
      expectedBranch: EXPECTED_BRANCH,
      runGit,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, status: "verified" });
  });

  it("resolves HEAD and the checked-out branch scoped to the workspace path", async () => {
    // Arrange
    const { runGit, calls } = fakeRunGit({});

    // Act
    await verifyGitIntegrity({
      workspacePath: "/workspace",
      expectedHeadSha: EXPECTED_HEAD_SHA,
      expectedBranch: EXPECTED_BRANCH,
      runGit,
    });

    // Assert
    expect(calls).toEqual([
      { args: ["rev-parse", "HEAD"], cwd: "/workspace" },
      { args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: "/workspace" },
    ]);
  });

  it("reports head_changed with both SHAs when HEAD no longer matches the expected SHA", async () => {
    // Arrange
    const actualHeadSha = "b".repeat(40);
    const { runGit } = fakeRunGit({ headSha: { stdout: `${actualHeadSha}\n` } });

    // Act
    const outcome = await verifyGitIntegrity({
      workspacePath: "/workspace",
      expectedHeadSha: EXPECTED_HEAD_SHA,
      expectedBranch: EXPECTED_BRANCH,
      runGit,
    });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "head_changed",
      expectedHeadSha: EXPECTED_HEAD_SHA,
      actualHeadSha,
    });
  });

  it("does not resolve the checked-out branch once HEAD has already changed", async () => {
    // Arrange
    const { runGit, calls } = fakeRunGit({ headSha: { stdout: `${"b".repeat(40)}\n` } });

    // Act
    await verifyGitIntegrity({
      workspacePath: "/workspace",
      expectedHeadSha: EXPECTED_HEAD_SHA,
      expectedBranch: EXPECTED_BRANCH,
      runGit,
    });

    // Assert
    expect(calls).toEqual([{ args: ["rev-parse", "HEAD"], cwd: "/workspace" }]);
  });

  it("reports branch_changed with both branch names when the checked-out branch no longer matches", async () => {
    // Arrange
    const { runGit } = fakeRunGit({ branch: { stdout: "feature-branch\n" } });

    // Act
    const outcome = await verifyGitIntegrity({
      workspacePath: "/workspace",
      expectedHeadSha: EXPECTED_HEAD_SHA,
      expectedBranch: EXPECTED_BRANCH,
      runGit,
    });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "branch_changed",
      expectedBranch: EXPECTED_BRANCH,
      actualBranch: "feature-branch",
    });
  });

  it("returns a safe inspection_failed outcome with the git exit code, never stderr, when resolving HEAD fails", async () => {
    // Arrange
    const { runGit } = fakeRunGit({ headSha: { ok: false, code: 128 } });

    // Act
    const outcome = await verifyGitIntegrity({
      workspacePath: "/workspace",
      expectedHeadSha: EXPECTED_HEAD_SHA,
      expectedBranch: EXPECTED_BRANCH,
      runGit,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "inspection_failed", stage: "resolve_head", gitErrorCode: 128 });
    expect(outcome).not.toHaveProperty("stderr");
  });

  it("returns a safe inspection_failed outcome with the git exit code, never stderr, when resolving the branch fails", async () => {
    // Arrange
    const { runGit } = fakeRunGit({ branch: { ok: false, code: "ENOENT" } });

    // Act
    const outcome = await verifyGitIntegrity({
      workspacePath: "/workspace",
      expectedHeadSha: EXPECTED_HEAD_SHA,
      expectedBranch: EXPECTED_BRANCH,
      runGit,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "inspection_failed", stage: "resolve_branch", gitErrorCode: "ENOENT" });
    expect(outcome).not.toHaveProperty("stderr");
  });

  it("never includes the workspace path or raw git output in a failure outcome", async () => {
    // Arrange
    const { runGit } = fakeRunGit({ headSha: { ok: false, code: 128 } });

    // Act
    const outcome = await verifyGitIntegrity({
      workspacePath: "/some/unsafe/workspace-path",
      expectedHeadSha: EXPECTED_HEAD_SHA,
      expectedBranch: EXPECTED_BRANCH,
      runGit,
    });

    // Assert
    expect(JSON.stringify(outcome)).not.toContain("/some/unsafe/workspace-path");
    expect(JSON.stringify(outcome)).not.toContain("unsafe stderr detail");
  });
});
