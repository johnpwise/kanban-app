import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runGit } from "./gitProcess";
import { inspectWorkingTree } from "./workingTreeInspection";

/** Builds a local temp git repository with a single committed file. */
async function createFixtureRepository(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-working-tree-fixture-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();

  run(["init", "--initial-branch=main"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await writeFile(join(path, "README.md"), "hello\n");
  run(["add", "README.md"]);
  run(["commit", "-m", "initial commit"]);

  return path;
}

describe("inspectWorkingTree against a real git working tree", () => {
  const fixturePaths: string[] = [];

  afterEach(async () => {
    await Promise.all(fixturePaths.map((path) => rm(path, { recursive: true, force: true })));
    fixturePaths.length = 0;
  });

  it("reports clean for a freshly committed working tree with no changes", async () => {
    // Arrange
    const workspacePath = await createFixtureRepository();
    fixturePaths.push(workspacePath);

    // Act
    const outcome = await inspectWorkingTree({ workspacePath, runGit });

    // Assert
    expect(outcome).toEqual({ ok: true, status: "clean" });
  });

  it("reports changes_detected for a modification to an already-tracked file", async () => {
    // Arrange
    const workspacePath = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await writeFile(join(workspacePath, "README.md"), "modified\n");

    // Act
    const outcome = await inspectWorkingTree({ workspacePath, runGit });

    // Assert
    expect(outcome).toEqual({ ok: true, status: "changes_detected" });
  });

  it("reports changes_detected for a newly created untracked file", async () => {
    // Arrange
    const workspacePath = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await writeFile(join(workspacePath, "new-file.ts"), "export {};\n");

    // Act
    const outcome = await inspectWorkingTree({ workspacePath, runGit });

    // Assert
    expect(outcome).toEqual({ ok: true, status: "changes_detected" });
  });

  it("fails safely with a git exit code, and no raw stderr, when the path is not a git repository", async () => {
    // Arrange
    const notARepo = await mkdtemp(join(tmpdir(), "ada-executor-not-a-repo-"));
    fixturePaths.push(notARepo);

    // Act
    const outcome = await inspectWorkingTree({ workspacePath: notARepo, runGit });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("status_failed");
    expect(["number", "string"]).toContain(typeof outcome.gitErrorCode);
    expect(outcome).not.toHaveProperty("stderr");
  });
});
