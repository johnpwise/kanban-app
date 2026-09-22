import { describe, expect, it } from "vitest";

import { inspectWorkingTree } from "./workingTreeInspection";

import type { RunGit } from "./gitProcess";

function fakeRunGit(behavior: { stdout?: string; ok?: boolean; code?: number | string | null }): RunGit {
  return async () => {
    if (behavior.ok === false) {
      return { ok: false, stderr: "fatal: unsafe stderr detail that must never be logged", code: behavior.code ?? 128 };
    }
    return { ok: true, stdout: behavior.stdout ?? "" };
  };
}

describe("inspectWorkingTree", () => {
  it("reports clean when git status reports no output", async () => {
    // Arrange
    const runGit = fakeRunGit({ stdout: "" });

    // Act
    const outcome = await inspectWorkingTree({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: true, status: "clean" });
  });

  it("reports clean when git status reports only trailing whitespace", async () => {
    // Arrange
    const runGit = fakeRunGit({ stdout: "\n" });

    // Act
    const outcome = await inspectWorkingTree({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: true, status: "clean" });
  });

  it("reports changes_detected when git status reports a modified tracked file", async () => {
    // Arrange
    const runGit = fakeRunGit({ stdout: " M src/index.ts\n" });

    // Act
    const outcome = await inspectWorkingTree({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: true, status: "changes_detected" });
  });

  it("reports changes_detected when git status reports a new untracked file", async () => {
    // Arrange
    const runGit = fakeRunGit({ stdout: "?? new-file.ts\n" });

    // Act
    const outcome = await inspectWorkingTree({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: true, status: "changes_detected" });
  });

  it("uses git status --porcelain=v1 for a stable machine-readable format, scoped to the workspace path", async () => {
    // Arrange
    const calls: { args: string[]; cwd?: string }[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      return { ok: true, stdout: "" };
    };

    // Act
    await inspectWorkingTree({ workspacePath: "/workspace", runGit });

    // Assert
    expect(calls).toEqual([{ args: ["status", "--porcelain=v1"], cwd: "/workspace" }]);
  });

  it("returns a safe failure with the git exit code, and never the raw stderr, when git status fails", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: 128 });

    // Act
    const outcome = await inspectWorkingTree({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "status_failed", gitErrorCode: 128 });
    expect(outcome).not.toHaveProperty("stderr");
  });

  it("never includes the workspace path or raw git output in a failure outcome", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: "ENOENT" });

    // Act
    const outcome = await inspectWorkingTree({ workspacePath: "/some/unsafe/workspace-path", runGit });

    // Assert
    expect(JSON.stringify(outcome)).not.toContain("/some/unsafe/workspace-path");
    expect(JSON.stringify(outcome)).not.toContain("unsafe stderr detail");
  });
});
