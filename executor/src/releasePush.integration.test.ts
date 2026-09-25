import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runGit } from "./gitProcess";
import { ensureReleaseStartPush } from "./releasePush";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";

/** A bare local git repository standing in for the GitHub remote — no network involved. */
async function createBareRemoteFixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-release-bare-remote-"));
  execFileSync("git", ["init", "--bare", "--initial-branch=main"], { cwd: path });
  return path;
}

async function createWorkspaceFixture(contentSeed = "release"): Promise<{ path: string; commitSha: string }> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-release-workspace-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();

  run(["init", "--initial-branch=main"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await writeFile(join(path, "package.json"), `{"version":"${contentSeed}"}\n`);
  run(["add", "package.json"]);
  run(["commit", "-m", `${contentSeed} commit`]);
  const commitSha = run(["rev-parse", "HEAD"]);

  return { path, commitSha };
}

const fakeMintOk: MintGithubDeliveryCredential = async () => ({
  ok: true,
  token: "integration-test-token",
  expiresAt: "2026-09-23T13:00:00Z",
});

describe("ensureReleaseStartPush (real local git remote)", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    while (cleanupPaths.length > 0) {
      const path = cleanupPaths.pop();
      if (path) {
        await rm(path, { recursive: true, force: true });
      }
    }
  });

  it("first publish: creates release/<version>, pushes the exact commit SHA, and independently verifies it", async () => {
    // Arrange
    const bareRemotePath = await createBareRemoteFixture();
    const workspace = await createWorkspaceFixture();
    cleanupPaths.push(bareRemotePath, workspace.path);

    // Act
    const result = await ensureReleaseStartPush({
      workspacePath: workspace.path,
      repository: "unused-in-this-test",
      releaseBranch: "release/1.4.0",
      releaseCommitSha: workspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: (params) => runGit({ ...params, args: params.args.map((arg) => arg.replace("https://github.com/unused-in-this-test.git", bareRemotePath)) }),
      mintCredential: fakeMintOk,
    });

    // Assert
    expect(result).toEqual({ ok: true, remoteBranch: "release/1.4.0", remoteSha: workspace.commitSha });
    const remoteRefs = execFileSync("git", ["ls-remote", bareRemotePath, "refs/heads/release/1.4.0"], { encoding: "utf8" }).trim();
    expect(remoteRefs).toContain(workspace.commitSha);
  });

  it("fails safely without force-overwriting when the remote release branch has diverged", async () => {
    // Arrange
    const bareRemotePath = await createBareRemoteFixture();
    const workspace = await createWorkspaceFixture();
    cleanupPaths.push(bareRemotePath, workspace.path);
    const runGitAgainstFixture = (params: Parameters<typeof runGit>[0]) =>
      runGit({ ...params, args: params.args.map((arg) => arg.replace("https://github.com/unused-in-this-test.git", bareRemotePath)) });

    const first = await ensureReleaseStartPush({
      workspacePath: workspace.path,
      repository: "unused-in-this-test",
      releaseBranch: "release/1.4.0",
      releaseCommitSha: workspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: runGitAgainstFixture,
      mintCredential: fakeMintOk,
    });
    expect(first.ok).toBe(true);

    const divergentWorkspace = await createWorkspaceFixture("divergent");
    cleanupPaths.push(divergentWorkspace.path);
    const divergentPush = await ensureReleaseStartPush({
      workspacePath: divergentWorkspace.path,
      repository: "unused-in-this-test",
      releaseBranch: "release/1.4.0",
      releaseCommitSha: divergentWorkspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: (params) => runGit({ ...params, args: params.args.map((arg) => arg.replace("https://github.com/unused-in-this-test.git", bareRemotePath)) }),
      mintCredential: fakeMintOk,
    });

    // Assert
    expect(divergentPush.ok).toBe(false);
    const remoteRefs = execFileSync("git", ["ls-remote", bareRemotePath, "refs/heads/release/1.4.0"], { encoding: "utf8" }).trim();
    expect(remoteRefs).toContain(workspace.commitSha);
    expect(remoteRefs).not.toContain(divergentWorkspace.commitSha);
  });

  it("re-publishing the same already-published SHA converges (idempotent, no force needed)", async () => {
    // Arrange
    const bareRemotePath = await createBareRemoteFixture();
    const workspace = await createWorkspaceFixture();
    cleanupPaths.push(bareRemotePath, workspace.path);
    const runGitAgainstFixture = (params: Parameters<typeof runGit>[0]) =>
      runGit({ ...params, args: params.args.map((arg) => arg.replace("https://github.com/unused-in-this-test.git", bareRemotePath)) });

    const first = await ensureReleaseStartPush({
      workspacePath: workspace.path,
      repository: "unused-in-this-test",
      releaseBranch: "release/1.4.0",
      releaseCommitSha: workspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: runGitAgainstFixture,
      mintCredential: fakeMintOk,
    });
    expect(first.ok).toBe(true);

    // Act
    const second = await ensureReleaseStartPush({
      workspacePath: workspace.path,
      repository: "unused-in-this-test",
      releaseBranch: "release/1.4.0",
      releaseCommitSha: workspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: runGitAgainstFixture,
      mintCredential: fakeMintOk,
    });

    // Assert
    expect(second).toEqual({ ok: true, remoteBranch: "release/1.4.0", remoteSha: workspace.commitSha });
  });
});
