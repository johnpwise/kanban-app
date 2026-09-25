import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureReleaseBranch } from "./releaseBranch";
import { runGit } from "./gitProcess";

/** Builds a local temp git repository with a single committed file on `develop`. */
async function createFixtureRepository(): Promise<{ path: string; headSha: string }> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-release-branch-fixture-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();

  run(["init", "--initial-branch=develop"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await writeFile(join(path, "package.json"), JSON.stringify({ name: "kanban-app", version: "0.1.0" }, null, 2) + "\n");
  run(["add", "package.json"]);
  run(["commit", "-m", "initial commit"]);
  const headSha = run(["rev-parse", "HEAD"]);

  return { path, headSha };
}

describe("ensureReleaseBranch against a real git workspace", () => {
  const fixturePaths: string[] = [];

  afterEach(async () => {
    await Promise.all(fixturePaths.map((path) => rm(path, { recursive: true, force: true })));
    fixturePaths.length = 0;
  });

  it("creates release/<version> from the current HEAD and verifies both branch and HEAD", async () => {
    // Arrange
    const { path: workspacePath, headSha } = await createFixtureRepository();
    fixturePaths.push(workspacePath);

    // Act
    const outcome = await ensureReleaseBranch({ workspacePath, version: "0.2.0", expectedHeadSha: headSha, runGit });

    // Assert
    expect(outcome).toEqual({ ok: true, branchName: "release/0.2.0" });
    const branchOutcome = await runGit({ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: workspacePath });
    expect(branchOutcome).toEqual({ ok: true, stdout: "release/0.2.0\n" });
  });

  it("fails closed with head_verification_failed, never silently proceeding, when the trusted sourceRevision does not match the workspace HEAD", async () => {
    // Arrange — simulates the TOCTOU case: eligibility trusted a sourceRevision that no longer matches this workspace's HEAD.
    const { path: workspacePath } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    const staleSourceRevision = "f".repeat(40);

    // Act
    const outcome = await ensureReleaseBranch({ workspacePath, version: "0.2.0", expectedHeadSha: staleSourceRevision, runGit });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "head_verification_failed",
      expectedHeadSha: staleSourceRevision,
      actualHeadSha: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    // The branch was still created locally (checkout -b runs before the HEAD re-check) but never reported as usable.
    const branchOutcome = await runGit({ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: workspacePath });
    expect(branchOutcome).toEqual({ ok: true, stdout: "release/0.2.0\n" });
  });

  it("fails closed with invalid_branch_name for a version that cannot derive a valid ref", async () => {
    // Arrange
    const { path: workspacePath, headSha } = await createFixtureRepository();
    fixturePaths.push(workspacePath);

    // Act — a version containing a leading dot after the namespace produces an invalid ref component.
    const outcome = await ensureReleaseBranch({ workspacePath, version: ".2.0", expectedHeadSha: headSha, runGit });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("invalid_branch_name");
  });

  it("fails closed with branch_creation_failed, and never re-attempts, when release/<version> already exists", async () => {
    // Arrange
    const { path: workspacePath, headSha } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    const first = await ensureReleaseBranch({ workspacePath, version: "0.2.0", expectedHeadSha: headSha, runGit });
    expect(first.ok).toBe(true);
    await runGit({ args: ["checkout", "develop"], cwd: workspacePath });

    // Act
    const outcome = await ensureReleaseBranch({ workspacePath, version: "0.2.0", expectedHeadSha: headSha, runGit });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("branch_creation_failed");
    expect(outcome).not.toHaveProperty("stderr");
  });
});
