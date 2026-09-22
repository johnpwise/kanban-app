import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { verifyGitIntegrity } from "./gitIntegrityVerification";
import { runGit } from "./gitProcess";

/** Builds a local temp git repository with a single committed file on `develop`. */
async function createFixtureRepository(): Promise<{ path: string; headSha: string }> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-git-integrity-fixture-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();

  run(["init", "--initial-branch=develop"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await writeFile(join(path, "README.md"), "hello\n");
  run(["add", "README.md"]);
  run(["commit", "-m", "initial commit"]);
  const headSha = run(["rev-parse", "HEAD"]);

  return { path, headSha };
}

describe("verifyGitIntegrity against a real git workspace", () => {
  const fixturePaths: string[] = [];

  afterEach(async () => {
    await Promise.all(fixturePaths.map((path) => rm(path, { recursive: true, force: true })));
    fixturePaths.length = 0;
  });

  it("reports verified when the coding agent only changed working-tree files", async () => {
    // Arrange
    const { path: workspacePath, headSha } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await writeFile(join(workspacePath, "README.md"), "modified by the coding agent\n");
    await writeFile(join(workspacePath, "new-file.ts"), "export {};\n");

    // Act
    const outcome = await verifyGitIntegrity({
      workspacePath,
      expectedHeadSha: headSha,
      expectedBranch: "develop",
      runGit,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, status: "verified" });
  });

  it("reports head_changed when the coding agent creates a local commit", async () => {
    // Arrange
    const { path: workspacePath, headSha } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    const run = (args: string[]) => execFileSync("git", args, { cwd: workspacePath, encoding: "utf8" }).trim();
    await writeFile(join(workspacePath, "agent-change.txt"), "unsanctioned commit\n");
    run(["add", "agent-change.txt"]);
    run(["commit", "-m", "unsanctioned coding-agent commit"]);
    const newHeadSha = run(["rev-parse", "HEAD"]);

    // Act
    const outcome = await verifyGitIntegrity({
      workspacePath,
      expectedHeadSha: headSha,
      expectedBranch: "develop",
      runGit,
    });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "head_changed",
      expectedHeadSha: headSha,
      actualHeadSha: newHeadSha,
    });
  });

  it("reports branch_changed when the coding agent switches to another branch", async () => {
    // Arrange
    const { path: workspacePath, headSha } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    const run = (args: string[]) => execFileSync("git", args, { cwd: workspacePath, encoding: "utf8" }).trim();
    run(["checkout", "-b", "coding-agent-branch"]);

    // Act
    const outcome = await verifyGitIntegrity({
      workspacePath,
      expectedHeadSha: headSha,
      expectedBranch: "develop",
      runGit,
    });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "branch_changed",
      expectedBranch: "develop",
      actualBranch: "coding-agent-branch",
    });
  });

  it("fails safely with a git exit code, and no raw stderr, when the path is not a git repository", async () => {
    // Arrange
    const notARepo = await mkdtemp(join(tmpdir(), "ada-executor-not-a-repo-"));
    fixturePaths.push(notARepo);

    // Act
    const outcome = await verifyGitIntegrity({
      workspacePath: notARepo,
      expectedHeadSha: "a".repeat(40),
      expectedBranch: "develop",
      runGit,
    });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("inspection_failed");
    if (outcome.reason !== "inspection_failed") return;
    expect(outcome.stage).toBe("resolve_head");
    expect(["number", "string"]).toContain(typeof outcome.gitErrorCode);
    expect(outcome).not.toHaveProperty("stderr");
  });
});
