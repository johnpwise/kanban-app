import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureReleaseCommit } from "./releaseCommit";
import { runGit } from "./gitProcess";

/** Builds a local temp git repository with root package.json/package-lock.json committed on a release branch — mirroring the workspace state `ensureReleaseBranch` hands to this capability. */
async function createFixtureRepository(): Promise<{ path: string; headSha: string; releaseBranch: string }> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-release-commit-fixture-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();

  run(["init", "--initial-branch=develop"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await writeFile(join(path, "package.json"), JSON.stringify({ name: "kanban-app", version: "0.1.0" }, null, 2) + "\n");
  await writeFile(
    join(path, "package-lock.json"),
    JSON.stringify({ name: "kanban-app", version: "0.1.0", lockfileVersion: 3, packages: { "": { name: "kanban-app", version: "0.1.0" } } }, null, 2) +
      "\n",
  );
  run(["add", "package.json", "package-lock.json"]);
  run(["commit", "-m", "initial commit"]);
  const headSha = run(["rev-parse", "HEAD"]);

  const releaseBranch = "release/0.2.0";
  run(["checkout", "-b", releaseBranch]);

  return { path, headSha, releaseBranch };
}

async function bumpVersionFiles(workspacePath: string): Promise<void> {
  const packageJson = JSON.parse(await readFile(join(workspacePath, "package.json"), "utf8"));
  packageJson.version = "0.2.0";
  await writeFile(join(workspacePath, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");

  const lockfile = JSON.parse(await readFile(join(workspacePath, "package-lock.json"), "utf8"));
  lockfile.version = "0.2.0";
  lockfile.packages[""].version = "0.2.0";
  await writeFile(join(workspacePath, "package-lock.json"), JSON.stringify(lockfile, null, 2) + "\n");
}

describe("ensureReleaseCommit against a real git workspace", () => {
  const fixturePaths: string[] = [];

  afterEach(async () => {
    await Promise.all(fixturePaths.map((path) => rm(path, { recursive: true, force: true })));
    fixturePaths.length = 0;
  });

  it("commits exactly the version-bump delta, leaving a clean tree", async () => {
    // Arrange
    const { path: workspacePath, headSha, releaseBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await bumpVersionFiles(workspacePath);

    // Act
    const outcome = await ensureReleaseCommit({
      workspacePath,
      version: "0.2.0",
      expectedBranch: releaseBranch,
      expectedParentSha: headSha,
      runGit,
    });

    // Assert
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.commitSha).toMatch(/^[0-9a-f]{40}$/);
    const statusOutcome = await runGit({ args: ["status", "--porcelain=v1"], cwd: workspacePath });
    expect(statusOutcome).toEqual({ ok: true, stdout: "" });
  });

  it("creates the commit on the release branch as a direct child of the exact trusted sourceRevision", async () => {
    // Arrange
    const { path: workspacePath, headSha, releaseBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await bumpVersionFiles(workspacePath);

    // Act
    const outcome = await ensureReleaseCommit({ workspacePath, version: "0.2.0", expectedBranch: releaseBranch, expectedParentSha: headSha, runGit });

    // Assert
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const parentOutcome = await runGit({ args: ["rev-parse", `${outcome.commitSha}^`], cwd: workspacePath });
    expect(parentOutcome).toEqual({ ok: true, stdout: `${headSha}\n` });
  });

  it("commits with the release-specific ADA identity, distinct from the delivery commit identity", async () => {
    // Arrange
    const { path: workspacePath, headSha, releaseBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await bumpVersionFiles(workspacePath);

    // Act
    const outcome = await ensureReleaseCommit({ workspacePath, version: "0.2.0", expectedBranch: releaseBranch, expectedParentSha: headSha, runGit });

    // Assert
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const authorOutcome = await runGit({ args: ["log", "-1", "--format=%an <%ae>", outcome.commitSha], cwd: workspacePath });
    expect(authorOutcome).toEqual({ ok: true, stdout: "ADA Release Engine <ada-release-engine@ada.local>\n" });
  });

  it("uses the deterministic chore(release) message", async () => {
    // Arrange
    const { path: workspacePath, headSha, releaseBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await bumpVersionFiles(workspacePath);

    // Act
    const outcome = await ensureReleaseCommit({ workspacePath, version: "0.2.0", expectedBranch: releaseBranch, expectedParentSha: headSha, runGit });

    // Assert
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const messageOutcome = await runGit({ args: ["log", "-1", "--format=%s", outcome.commitSha], cwd: workspacePath });
    expect(messageOutcome).toEqual({ ok: true, stdout: "chore(release): prepare v0.2.0\n" });
  });

  it("does not invoke a repository-controlled commit-msg hook", async () => {
    // Arrange
    const { path: workspacePath, headSha, releaseBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await writeFile(
      join(workspacePath, ".git", "hooks", "commit-msg"),
      "#!/bin/sh\necho 'blocked by repository-controlled hook' >&2\nexit 1\n",
      { mode: 0o755 },
    );
    await bumpVersionFiles(workspacePath);

    // Act
    const outcome = await ensureReleaseCommit({ workspacePath, version: "0.2.0", expectedBranch: releaseBranch, expectedParentSha: headSha, runGit });

    // Assert
    expect(outcome.ok).toBe(true);
  });

  it("fails closed and stages nothing when an unrelated file was modified alongside the version bump", async () => {
    // Arrange
    const { path: workspacePath, headSha, releaseBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await bumpVersionFiles(workspacePath);
    await writeFile(join(workspacePath, "README.md"), "unexpected change\n");

    // Act
    const outcome = await ensureReleaseCommit({ workspacePath, version: "0.2.0", expectedBranch: releaseBranch, expectedParentSha: headSha, runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "unexpected_release_delta", paths: ["README.md"] });
    const statusOutcome = await runGit({ args: ["status", "--porcelain=v1"], cwd: workspacePath });
    expect(statusOutcome.ok && statusOutcome.stdout.includes("A  ")).toBe(false);
  });

  it("fails closed with a real git exit code, no raw stderr, when there are no version changes to stage", async () => {
    // Arrange
    const { path: workspacePath, headSha, releaseBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);

    // Act
    const outcome = await ensureReleaseCommit({ workspacePath, version: "0.1.0", expectedBranch: releaseBranch, expectedParentSha: headSha, runGit });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("commit_failed");
    expect(outcome).not.toHaveProperty("stderr");
  });
});
