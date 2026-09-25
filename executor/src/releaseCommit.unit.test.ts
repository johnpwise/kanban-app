import { describe, expect, it } from "vitest";

import { deriveReleaseCommitMessage, ensureReleaseCommit, stageReleaseFiles, verifyReleaseWorkingTreeDelta } from "./releaseCommit";

import type { RunGit, RunGitParams } from "./gitProcess";

function fakeRunGit(behavior: { stdout?: string; ok?: boolean; code?: number | string | null }): RunGit {
  return async () => {
    if (behavior.ok === false) {
      return { ok: false, stderr: "fatal: unsafe stderr detail that must never be logged", code: behavior.code ?? 128 };
    }
    return { ok: true, stdout: behavior.stdout ?? "" };
  };
}

describe("deriveReleaseCommitMessage", () => {
  it("derives chore(release): prepare v<version> with no other variable component", () => {
    expect(deriveReleaseCommitMessage("1.4.0")).toBe("chore(release): prepare v1.4.0");
  });

  it("derives the same message for the same version every time", () => {
    expect(deriveReleaseCommitMessage("1.4.0")).toBe(deriveReleaseCommitMessage("1.4.0"));
  });

  it("takes only version — no parameter for task title, prompt, or repository content", () => {
    expect(deriveReleaseCommitMessage.length).toBe(1);
  });
});

describe("verifyReleaseWorkingTreeDelta", () => {
  it("succeeds when only package.json and package-lock.json are modified", async () => {
    // Arrange
    const runGit = fakeRunGit({ stdout: " M package.json\n M package-lock.json\n" });

    // Act
    const outcome = await verifyReleaseWorkingTreeDelta({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: true });
  });

  it("fails closed with unexpected_release_delta when any other file changed", async () => {
    // Arrange
    const runGit = fakeRunGit({ stdout: " M package.json\n M package-lock.json\n M src/app/page.tsx\n" });

    // Act
    const outcome = await verifyReleaseWorkingTreeDelta({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "unexpected_release_delta", paths: ["src/app/page.tsx"] });
  });

  it("fails closed with unexpected_release_delta when an untracked file is present", async () => {
    // Arrange
    const runGit = fakeRunGit({ stdout: " M package.json\n M package-lock.json\n?? notes.txt\n" });

    // Act
    const outcome = await verifyReleaseWorkingTreeDelta({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "unexpected_release_delta", paths: ["notes.txt"] });
  });

  it("returns a safe failure with the git exit code, never raw stderr, when status inspection fails", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: 128 });

    // Act
    const outcome = await verifyReleaseWorkingTreeDelta({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "status_inspection_failed", gitErrorCode: 128 });
    expect(outcome).not.toHaveProperty("stderr");
  });
});

describe("stageReleaseFiles", () => {
  it("stages exactly package.json and package-lock.json by explicit pathspec, never -A", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await stageReleaseFiles({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: true });
    expect(calls).toEqual([{ args: ["add", "--", "package.json", "package-lock.json"], cwd: "/workspace" }]);
  });

  it("returns a safe failure with the git exit code when staging fails", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: 128 });

    // Act
    const outcome = await stageReleaseFiles({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "staging_failed", gitErrorCode: 128 });
  });
});

describe("ensureReleaseCommit", () => {
  const request = {
    workspacePath: "/workspace",
    version: "1.4.0",
    expectedBranch: "release/1.4.0",
    expectedParentSha: "a".repeat(40),
  };
  const commitSha = "c".repeat(40);

  function successfulRunGit(): RunGit {
    return async (params) => {
      if (params.args[0] === "status") return { ok: true, stdout: " M package.json\n M package-lock.json\n" };
      if (params.args[0] === "add") return { ok: true, stdout: "" };
      if (params.args.includes("commit")) return { ok: true, stdout: "" };
      if (params.args[0] === "rev-parse" && params.args[1] === "HEAD") return { ok: true, stdout: `${commitSha}\n` };
      if (params.args[0] === "rev-parse" && params.args[1] === "--abbrev-ref") return { ok: true, stdout: `${request.expectedBranch}\n` };
      if (params.args[0] === "rev-parse") return { ok: true, stdout: `${request.expectedParentSha}\n` };
      if (params.args[0] === "diff-tree") return { ok: true, stdout: "package-lock.json\npackage.json\n" };
      return { ok: true, stdout: "" };
    };
  }

  it("verifies the working tree, stages, commits, resolves, verifies topology, and verifies the commit delta — returning the SHA on success", async () => {
    // Act
    const outcome = await ensureReleaseCommit({ ...request, runGit: successfulRunGit() });

    // Assert
    expect(outcome).toEqual({ ok: true, commitSha });
  });

  it("runs the working-tree check before staging, and staging before committing", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const inner = successfulRunGit();
    const runGit: RunGit = async (params) => {
      calls.push(params);
      return inner(params);
    };

    // Act
    await ensureReleaseCommit({ ...request, runGit });

    // Assert
    expect(calls[0]?.args[0]).toBe("status");
    expect(calls[1]?.args[0]).toBe("add");
    expect(calls[2]?.args).toContain("commit");
  });

  it("never stages when an unexpected working-tree change is present", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      if (params.args[0] === "status") return { ok: true, stdout: " M package.json\n M package-lock.json\n M src/app/page.tsx\n" };
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureReleaseCommit({ ...request, runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "unexpected_release_delta", paths: ["src/app/page.tsx"] });
    expect(calls).toHaveLength(1);
  });

  it("returns a safe failure and never commits when staging fails", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      if (params.args[0] === "status") return { ok: true, stdout: " M package.json\n M package-lock.json\n" };
      if (params.args[0] === "add") return { ok: false, stderr: "unsafe detail", code: 128 };
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureReleaseCommit({ ...request, runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "staging_failed", gitErrorCode: 128 });
    expect(calls).toHaveLength(2);
  });

  it("returns a safe failure when post-commit topology verification reports a parent mismatch", async () => {
    // Arrange
    const runGit: RunGit = async (params) => {
      if (params.args[0] === "status") return { ok: true, stdout: " M package.json\n M package-lock.json\n" };
      if (params.args[0] === "add") return { ok: true, stdout: "" };
      if (params.args.includes("commit")) return { ok: true, stdout: "" };
      if (params.args[0] === "rev-parse" && params.args[1] === "HEAD") return { ok: true, stdout: `${commitSha}\n` };
      if (params.args[0] === "rev-parse" && params.args[1] === "--abbrev-ref") return { ok: true, stdout: `${request.expectedBranch}\n` };
      if (params.args[0] === "rev-parse") return { ok: true, stdout: `${"e".repeat(40)}\n` };
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureReleaseCommit({ ...request, runGit });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "parent_mismatch",
      expectedParentSha: request.expectedParentSha,
      actualParentSha: "e".repeat(40),
    });
  });

  it("returns a safe commit_delta_mismatch failure, never trusting the commit's own success, when the commit contains an unexpected file", async () => {
    // Arrange
    const runGit: RunGit = async (params) => {
      if (params.args[0] === "status") return { ok: true, stdout: " M package.json\n M package-lock.json\n" };
      if (params.args[0] === "add") return { ok: true, stdout: "" };
      if (params.args.includes("commit")) return { ok: true, stdout: "" };
      if (params.args[0] === "rev-parse" && params.args[1] === "HEAD") return { ok: true, stdout: `${commitSha}\n` };
      if (params.args[0] === "rev-parse" && params.args[1] === "--abbrev-ref") return { ok: true, stdout: `${request.expectedBranch}\n` };
      if (params.args[0] === "rev-parse") return { ok: true, stdout: `${request.expectedParentSha}\n` };
      if (params.args[0] === "diff-tree") return { ok: true, stdout: "package-lock.json\npackage.json\nREADME.md\n" };
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureReleaseCommit({ ...request, runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "commit_delta_mismatch", paths: ["README.md", "package-lock.json", "package.json"] });
  });

  it("never includes raw stderr or the workspace path in any failure outcome", async () => {
    // Arrange
    const runGit: RunGit = async () => ({ ok: false, stderr: "fatal: unsafe stderr detail", code: 1 });

    // Act
    const outcome = await ensureReleaseCommit({ ...request, workspacePath: "/some/unsafe/workspace-path", runGit });

    // Assert
    expect(JSON.stringify(outcome)).not.toContain("/some/unsafe/workspace-path");
    expect(JSON.stringify(outcome)).not.toContain("unsafe stderr detail");
  });
});
