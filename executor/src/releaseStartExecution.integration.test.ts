import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { executeEligibleReleaseStart } from "./releaseStartExecution";
import { runGit } from "./gitProcess";
import { materializeRepositoryWorkspace as realMaterializeRepositoryWorkspace } from "./repositoryWorkspace";

import type { ReleaseEligibilityOutcome } from "./releaseEligibility";
import type { MintGithubDeliveryCredential } from "./githubAppCredential";
import type { MaterializeRepositoryWorkspace } from "./repositoryWorkspace";
import type { RunGit } from "./gitProcess";

const PLACEHOLDER_REPOSITORY = "unused-in-this-test/kanban-app";
const PLACEHOLDER_ORIGIN_URL = `https://github.com/${PLACEHOLDER_REPOSITORY}.git`;

/** Builds a local temp source repository with root package.json/package-lock.json committed on `develop`. */
async function createSourceFixtureRepository(): Promise<{ path: string; headSha: string }> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-release-start-source-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();

  run(["init", "--initial-branch=develop"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await writeFile(join(path, "package.json"), JSON.stringify({ name: "kanban-app", version: "1.3.0" }, null, 2) + "\n");
  await writeFile(
    join(path, "package-lock.json"),
    JSON.stringify({ name: "kanban-app", version: "1.3.0", lockfileVersion: 3, packages: { "": { name: "kanban-app", version: "1.3.0" } } }, null, 2) +
      "\n",
  );
  run(["add", "package.json", "package-lock.json"]);
  run(["commit", "-m", "initial commit"]);
  const headSha = run(["rev-parse", "HEAD"]);

  return { path, headSha };
}

async function createBareRemoteFixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-release-start-remote-"));
  execFileSync("git", ["init", "--bare", "--initial-branch=main"], { cwd: path });
  return path;
}

function runGitAgainstRemoteFixture(bareRemotePath: string): RunGit {
  return (params) => runGit({ ...params, args: params.args.map((arg) => arg.replace(PLACEHOLDER_ORIGIN_URL, bareRemotePath)) });
}

const fakeMintCredential: MintGithubDeliveryCredential = async () => ({
  ok: true,
  token: "integration-test-token",
  expiresAt: "2026-09-23T13:00:00Z",
});

describe("executeEligibleReleaseStart against real local git (source clone + bare remote)", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupPaths.map((path) => rm(path, { recursive: true, force: true })));
    cleanupPaths.length = 0;
  });

  it("completes the full guarded release-start end-to-end: branch, verified version bump, verified commit, authenticated push, verified remote", async () => {
    // Arrange
    const source = await createSourceFixtureRepository();
    const bareRemotePath = await createBareRemoteFixture();
    cleanupPaths.push(source.path, bareRemotePath);

    const eligibility: ReleaseEligibilityOutcome = {
      eligible: true,
      releaseIntentId: "release-intent-1",
      repository: PLACEHOLDER_REPOSITORY,
      version: "1.4.0",
      sourceBranch: "develop",
      sourceRevision: source.headSha,
    };
    const trackedRunGit = runGitAgainstRemoteFixture(bareRemotePath);
    const materializeRepositoryWorkspace: MaterializeRepositoryWorkspace = (request) =>
      realMaterializeRepositoryWorkspace({ ...request, runGit: trackedRunGit, buildCloneUrl: () => source.path });

    // Act
    const result = await executeEligibleReleaseStart({
      releaseIntentId: "release-intent-1",
      evaluateReleaseEligibility: async () => eligibility,
      materializeRepositoryWorkspace,
      runGit: trackedRunGit,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      mintCredential: fakeMintCredential,
    });

    // Assert
    expect(result.outcome).toBe("started");
    if (result.outcome !== "started") return;
    expect(result).toEqual({
      outcome: "started",
      releaseIntentId: "release-intent-1",
      repository: PLACEHOLDER_REPOSITORY,
      version: "1.4.0",
      releaseBranch: "release/1.4.0",
      commitSha: result.commitSha,
      remoteSha: result.commitSha,
    });
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);

    const remoteRefs = execFileSync("git", ["ls-remote", bareRemotePath, "refs/heads/release/1.4.0"], { encoding: "utf8" }).trim();
    expect(remoteRefs).toContain(result.commitSha);

    // The pushed commit's parent must be exactly the trusted sourceRevision, and its version files
    // must carry exactly the trusted version — verified by inspecting the bare remote directly.
    const parentSha = execFileSync("git", ["--git-dir", bareRemotePath, "rev-parse", `${result.commitSha}^`], { encoding: "utf8" }).trim();
    expect(parentSha).toBe(source.headSha);
    const packageJsonContent = execFileSync("git", ["--git-dir", bareRemotePath, "show", `${result.commitSha}:package.json`], { encoding: "utf8" });
    expect(JSON.parse(packageJsonContent).version).toBe("1.4.0");
  });

  it("fails closed with source_revision_drift and publishes nothing when develop has moved since eligibility was evaluated", async () => {
    // Arrange — the fresh eligibility result trusts a sourceRevision that no longer matches the source repository's live HEAD.
    const source = await createSourceFixtureRepository();
    const bareRemotePath = await createBareRemoteFixture();
    cleanupPaths.push(source.path, bareRemotePath);
    const staleSourceRevision = "f".repeat(40);

    const eligibility: ReleaseEligibilityOutcome = {
      eligible: true,
      releaseIntentId: "release-intent-1",
      repository: PLACEHOLDER_REPOSITORY,
      version: "1.4.0",
      sourceBranch: "develop",
      sourceRevision: staleSourceRevision,
    };
    const trackedRunGit = runGitAgainstRemoteFixture(bareRemotePath);
    const materializeRepositoryWorkspace: MaterializeRepositoryWorkspace = (request) =>
      realMaterializeRepositoryWorkspace({ ...request, runGit: trackedRunGit, buildCloneUrl: () => source.path });

    // Act
    const result = await executeEligibleReleaseStart({
      releaseIntentId: "release-intent-1",
      evaluateReleaseEligibility: async () => eligibility,
      materializeRepositoryWorkspace,
      runGit: trackedRunGit,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      mintCredential: fakeMintCredential,
    });

    // Assert
    expect(result).toEqual({
      outcome: "source_revision_drift",
      releaseIntentId: "release-intent-1",
      repository: PLACEHOLDER_REPOSITORY,
      expectedSourceRevision: staleSourceRevision,
      actualSourceRevision: source.headSha,
    });
    const remoteRefs = execFileSync("git", ["for-each-ref", "refs/heads/release/1.4.0"], { cwd: bareRemotePath, encoding: "utf8" }).trim();
    expect(remoteRefs).toBe("");
  });
});
