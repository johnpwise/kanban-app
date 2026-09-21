import { execFileSync } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

import { runGit } from "./gitProcess";
import { materializeRepositoryWorkspace } from "./repositoryWorkspace";

import type { RunGit } from "./gitProcess";

/** Builds a local temp git repository with a "main" default branch and a diverging "feature-branch". */
async function createFixtureRepository(): Promise<{ path: string; mainSha: string; featureSha: string }> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-fixture-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();

  run(["init", "--initial-branch=main"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await writeFile(join(path, "README.md"), "main\n");
  run(["add", "README.md"]);
  run(["commit", "-m", "main commit"]);
  const mainSha = run(["rev-parse", "HEAD"]);

  run(["checkout", "-b", "feature-branch"]);
  await writeFile(join(path, "README.md"), "feature\n");
  run(["add", "README.md"]);
  run(["commit", "-m", "feature commit"]);
  const featureSha = run(["rev-parse", "HEAD"]);

  run(["checkout", "main"]);

  return { path, mainSha, featureSha };
}

/** Wraps the real `runGit` to record every workspace path it touches, so failure tests can assert cleanup. */
function trackingRunGit(): { runGit: RunGit; touchedPaths: string[] } {
  const touchedPaths: string[] = [];
  const wrapped: RunGit = async (params) => {
    if (params.cwd) {
      touchedPaths.push(params.cwd);
    }
    if (params.args[0] === "clone") {
      touchedPaths.push(params.args[params.args.length - 1]);
    }
    return runGit(params);
  };
  return { runGit: wrapped, touchedPaths };
}

describe("materializeRepositoryWorkspace", () => {
  const fixturePaths: string[] = [];
  const workspacePaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      [...fixturePaths, ...workspacePaths].map((path) => rm(path, { recursive: true, force: true })),
    );
    fixturePaths.length = 0;
    workspacePaths.length = 0;
  });

  it("clones the repository, checks out the requested branch, and returns a determinable HEAD SHA", async () => {
    // Arrange
    const fixture = await createFixtureRepository();
    fixturePaths.push(fixture.path);
    const { runGit: tracked, touchedPaths } = trackingRunGit();
    workspacePaths.push(...touchedPaths);

    // Act
    const outcome = await materializeRepositoryWorkspace({
      repository: "owner/repo",
      baseBranch: "main",
      runGit: tracked,
      buildCloneUrl: () => fixture.path,
    });

    // Assert
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    workspacePaths.push(outcome.workspace.path);
    expect(outcome.workspace.headSha).toBe(fixture.mainSha);
    expect(outcome.workspace.headSha).toMatch(/^[0-9a-f]{40}$/);
    await expect(stat(outcome.workspace.path)).resolves.toBeDefined();

    // cleanup
    await outcome.cleanup();
    await expect(stat(outcome.workspace.path)).rejects.toThrow();
  });

  it("checks out exactly the requested baseBranch rather than the clone's default branch", async () => {
    // Arrange
    const fixture = await createFixtureRepository();
    fixturePaths.push(fixture.path);
    const { runGit: tracked, touchedPaths } = trackingRunGit();
    workspacePaths.push(...touchedPaths);

    // Act
    const outcome = await materializeRepositoryWorkspace({
      repository: "owner/repo",
      baseBranch: "feature-branch",
      runGit: tracked,
      buildCloneUrl: () => fixture.path,
    });

    // Assert
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    workspacePaths.push(outcome.workspace.path);
    expect(outcome.workspace.headSha).toBe(fixture.featureSha);
    expect(outcome.workspace.headSha).not.toBe(fixture.mainSha);
    await outcome.cleanup();
  });

  it("fails safely when the repository cannot be cloned, and leaves no workspace behind", async () => {
    // Arrange
    const nonexistentSource = join(tmpdir(), `ada-executor-missing-${randomUUID()}`);
    const { runGit: tracked, touchedPaths } = trackingRunGit();

    // Act
    const outcome = await materializeRepositoryWorkspace({
      repository: "owner/repo",
      baseBranch: "main",
      runGit: tracked,
      buildCloneUrl: () => nonexistentSource,
    });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("clone_failed");
    const cloneDestination = touchedPaths.at(-1);
    expect(cloneDestination).toBeDefined();
    await expect(stat(cloneDestination as string)).rejects.toThrow();
  });

  it("reports the failing git command's exit code when the clone fails, without any raw git output", async () => {
    // Arrange
    const nonexistentSource = join(tmpdir(), `ada-executor-missing-${randomUUID()}`);

    // Act
    const outcome = await materializeRepositoryWorkspace({
      repository: "owner/repo",
      baseBranch: "main",
      runGit,
      buildCloneUrl: () => nonexistentSource,
    });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== "clone_failed") throw new Error("expected clone_failed");
    expect(["number", "string"]).toContain(typeof outcome.gitErrorCode);
    expect(outcome).not.toHaveProperty("stderr");
    expect(outcome).not.toHaveProperty("unsafeDebugStderr");
  });

  it("captures the failing clone command's raw stderr only when explicitly opted in via captureUnsafeDebugStderr (temporary diagnostic)", async () => {
    // Arrange
    const nonexistentSource = join(tmpdir(), `ada-executor-missing-${randomUUID()}`);

    // Act
    const outcome = await materializeRepositoryWorkspace({
      repository: "owner/repo",
      baseBranch: "main",
      runGit,
      buildCloneUrl: () => nonexistentSource,
      captureUnsafeDebugStderr: true,
    });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== "clone_failed") throw new Error("expected clone_failed");
    expect(typeof outcome.unsafeDebugStderr).toBe("string");
    expect((outcome.unsafeDebugStderr ?? "").length).toBeGreaterThan(0);
  });

  it("fails safely with no fallback when the requested branch does not exist, and leaves no workspace behind", async () => {
    // Arrange
    const fixture = await createFixtureRepository();
    fixturePaths.push(fixture.path);
    const { runGit: tracked, touchedPaths } = trackingRunGit();

    // Act
    const outcome = await materializeRepositoryWorkspace({
      repository: "owner/repo",
      baseBranch: "does-not-exist",
      runGit: tracked,
      buildCloneUrl: () => fixture.path,
    });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("checkout_failed");
    const workspacePath = touchedPaths.find((path) => path !== fixture.path);
    expect(workspacePath).toBeDefined();
    await expect(stat(workspacePath as string)).rejects.toThrow();
  });

  it("reports the failing git command's exit code when the checkout fails, without any raw git output", async () => {
    // Arrange
    const fixture = await createFixtureRepository();
    fixturePaths.push(fixture.path);

    // Act
    const outcome = await materializeRepositoryWorkspace({
      repository: "owner/repo",
      baseBranch: "does-not-exist",
      runGit,
      buildCloneUrl: () => fixture.path,
    });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== "checkout_failed") throw new Error("expected checkout_failed");
    expect(["number", "string"]).toContain(typeof outcome.gitErrorCode);
    expect(outcome).not.toHaveProperty("stderr");
    expect(outcome).not.toHaveProperty("unsafeDebugStderr");
  });

  it("captures the failing checkout command's raw stderr only when explicitly opted in via captureUnsafeDebugStderr (temporary diagnostic)", async () => {
    // Arrange
    const fixture = await createFixtureRepository();
    fixturePaths.push(fixture.path);

    // Act
    const outcome = await materializeRepositoryWorkspace({
      repository: "owner/repo",
      baseBranch: "does-not-exist",
      runGit,
      buildCloneUrl: () => fixture.path,
      captureUnsafeDebugStderr: true,
    });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.reason !== "checkout_failed") throw new Error("expected checkout_failed");
    expect(typeof outcome.unsafeDebugStderr).toBe("string");
    expect((outcome.unsafeDebugStderr ?? "").length).toBeGreaterThan(0);
  });
});
