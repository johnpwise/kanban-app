import { describe, expect, it } from "vitest";

import { deriveReleaseBranchName, ensureReleaseBranch } from "./releaseBranch";

import type { RunGit, RunGitParams } from "./gitProcess";

const SOURCE_REVISION = "a".repeat(40);

function fakeRunGit(behavior: { stdout?: string; ok?: boolean; code?: number | string | null }): RunGit {
  return async () => {
    if (behavior.ok === false) {
      return { ok: false, stderr: "fatal: unsafe stderr detail that must never be logged", code: behavior.code ?? 128 };
    }
    return { ok: true, stdout: behavior.stdout ?? "" };
  };
}

describe("deriveReleaseBranchName", () => {
  it("derives release/<version> with no other variable component", () => {
    // Act
    const branchName = deriveReleaseBranchName("1.4.0");

    // Assert
    expect(branchName).toBe("release/1.4.0");
  });

  it("derives the same branch name for the same version every time", () => {
    // Act
    const first = deriveReleaseBranchName("1.4.0");
    const second = deriveReleaseBranchName("1.4.0");

    // Assert
    expect(first).toBe(second);
  });

  it("takes only version — there is no parameter for repository, sourceBranch, or sourceRevision", () => {
    // Assert (type-level proof: calling with a second argument is a compile error, not a runtime behavior)
    expect(deriveReleaseBranchName.length).toBe(1);
  });
});

describe("ensureReleaseBranch", () => {
  function successfulRunGit(checkedOutBranch: string, headSha: string): RunGit {
    return async (params) => {
      if (params.args[0] === "check-ref-format") return { ok: true, stdout: "" };
      if (params.args[0] === "checkout") return { ok: true, stdout: "" };
      if (params.args[0] === "rev-parse" && params.args[1] === "--abbrev-ref") return { ok: true, stdout: `${checkedOutBranch}\n` };
      if (params.args[0] === "rev-parse" && params.args[1] === "HEAD") return { ok: true, stdout: `${headSha}\n` };
      return { ok: true, stdout: "" };
    };
  }

  it("derives, validates, creates, and verifies the release branch — returning its name on success", async () => {
    // Arrange
    const runGit = successfulRunGit("release/1.4.0", SOURCE_REVISION);

    // Act
    const outcome = await ensureReleaseBranch({
      workspacePath: "/workspace",
      version: "1.4.0",
      expectedHeadSha: SOURCE_REVISION,
      runGit,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, branchName: "release/1.4.0" });
  });

  it("validates using git's own check-ref-format against refs/heads/release/<version>", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const inner = successfulRunGit("release/1.4.0", SOURCE_REVISION);
    const runGit: RunGit = async (params) => {
      calls.push(params);
      return inner(params);
    };

    // Act
    await ensureReleaseBranch({ workspacePath: "/workspace", version: "1.4.0", expectedHeadSha: SOURCE_REVISION, runGit });

    // Assert
    expect(calls[0]).toEqual({ args: ["check-ref-format", "refs/heads/release/1.4.0"] });
  });

  it("creates the branch via checkout -b with the branch name as its own argv element", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const inner = successfulRunGit("release/1.4.0", SOURCE_REVISION);
    const runGit: RunGit = async (params) => {
      calls.push(params);
      return inner(params);
    };

    // Act
    await ensureReleaseBranch({ workspacePath: "/workspace", version: "1.4.0", expectedHeadSha: SOURCE_REVISION, runGit });

    // Assert
    expect(calls).toContainEqual({ args: ["checkout", "-b", "release/1.4.0"], cwd: "/workspace" });
  });

  it("returns a safe failure and never attempts creation when the derived branch name is invalid", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: 1 });

    // Act
    const outcome = await ensureReleaseBranch({ workspacePath: "/workspace", version: "1.4.0", expectedHeadSha: SOURCE_REVISION, runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "invalid_branch_name", gitErrorCode: 1 });
  });

  it("returns a safe failure when branch creation fails", async () => {
    // Arrange
    const runGit: RunGit = async (params) => {
      if (params.args[0] === "check-ref-format") return { ok: true, stdout: "" };
      return { ok: false, stderr: "unsafe detail", code: 128 };
    };

    // Act
    const outcome = await ensureReleaseBranch({ workspacePath: "/workspace", version: "1.4.0", expectedHeadSha: SOURCE_REVISION, runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "branch_creation_failed", gitErrorCode: 128 });
  });

  it("returns a safe failure when the checked-out branch does not verify as the release branch", async () => {
    // Arrange
    const runGit = successfulRunGit("some-other-branch", SOURCE_REVISION);

    // Act
    const outcome = await ensureReleaseBranch({ workspacePath: "/workspace", version: "1.4.0", expectedHeadSha: SOURCE_REVISION, runGit });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "branch_verification_failed",
      expectedBranch: "release/1.4.0",
      actualBranch: "some-other-branch",
    });
  });

  it("returns a safe failure when HEAD does not verify as the exact trusted sourceRevision — never touching release files on drift", async () => {
    // Arrange
    const runGit = successfulRunGit("release/1.4.0", "f".repeat(40));

    // Act
    const outcome = await ensureReleaseBranch({ workspacePath: "/workspace", version: "1.4.0", expectedHeadSha: SOURCE_REVISION, runGit });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "head_verification_failed",
      expectedHeadSha: SOURCE_REVISION,
      actualHeadSha: "f".repeat(40),
    });
  });

  it("never verifies HEAD before the branch itself verifies", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      if (params.args[0] === "check-ref-format") return { ok: true, stdout: "" };
      if (params.args[0] === "checkout") return { ok: true, stdout: "" };
      return { ok: true, stdout: "some-other-branch\n" };
    };

    // Act
    await ensureReleaseBranch({ workspacePath: "/workspace", version: "1.4.0", expectedHeadSha: SOURCE_REVISION, runGit });

    // Assert — only one rev-parse call (branch check), never a second one for HEAD
    const revParseCalls = calls.filter((call) => call.args[0] === "rev-parse");
    expect(revParseCalls).toHaveLength(1);
  });

  it("never includes raw stderr or the workspace path in any failure outcome", async () => {
    // Arrange
    const runGit: RunGit = async () => ({ ok: false, stderr: "fatal: unsafe stderr detail", code: 1 });

    // Act
    const outcome = await ensureReleaseBranch({
      workspacePath: "/some/unsafe/workspace-path",
      version: "1.4.0",
      expectedHeadSha: SOURCE_REVISION,
      runGit,
    });

    // Assert
    expect(JSON.stringify(outcome)).not.toContain("/some/unsafe/workspace-path");
    expect(JSON.stringify(outcome)).not.toContain("unsafe stderr detail");
  });
});
