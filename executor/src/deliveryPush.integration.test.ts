import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runGit } from "./gitProcess";
import { ensureAdaDeliveryPush } from "./deliveryPush";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";

/** A bare local git repository standing in for the GitHub remote — no network involved. */
async function createBareRemoteFixture(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-bare-remote-"));
  execFileSync("git", ["init", "--bare", "--initial-branch=main"], { cwd: path });
  return path;
}

/**
 * A local clone-equivalent workspace with one commit on `main`, used as the "delivery" source.
 * `contentSeed` guarantees a distinct commit (distinct tree + message) across fixtures created
 * within the same wall-clock second, so two independently created workspaces never coincidentally
 * produce the same commit SHA.
 */
async function createWorkspaceFixture(contentSeed = "delivery"): Promise<{ path: string; commitSha: string }> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-workspace-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();

  run(["init", "--initial-branch=main"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await writeFile(join(path, "README.md"), `${contentSeed}\n`);
  run(["add", "README.md"]);
  run(["commit", "-m", `${contentSeed} commit`]);
  const commitSha = run(["rev-parse", "HEAD"]);

  return { path, commitSha };
}

/**
 * Plants a client-side `pre-push` hook in the *workspace* being pushed from — the hook Codex's
 * workspace-write sandbox could plant into the materialised, attacker-influenced repository. If
 * executed it proves so by writing a marker file; `git push --no-verify` must prevent that.
 */
async function installPrePushHookMarker(workspacePath: string): Promise<string> {
  const markerPath = join(workspacePath, "hook-ran.marker");
  const hookPath = join(workspacePath, ".git", "hooks", "pre-push");
  await writeFile(hookPath, `#!/bin/sh\ntouch "${markerPath}"\nexit 0\n`, { mode: 0o755 });
  return markerPath;
}

const fakeMintOk: MintGithubDeliveryCredential = async () => ({
  ok: true,
  token: "integration-test-token",
  expiresAt: "2026-09-23T13:00:00Z",
});

describe("ensureAdaDeliveryPush (real local git remote)", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    while (cleanupPaths.length > 0) {
      const path = cleanupPaths.pop();
      if (path) {
        await rm(path, { recursive: true, force: true });
      }
    }
  });

  it("first publish: creates the branch, pushes the exact commit SHA, and independently verifies it", async () => {
    // Arrange
    const bareRemotePath = await createBareRemoteFixture();
    const workspace = await createWorkspaceFixture();
    cleanupPaths.push(bareRemotePath, workspace.path);

    // Act — `repository` here is a local filesystem path standing in for `owner/repo`; the module
    // under test doesn't care what `buildDeliveryPushUrl` would have produced for the real host,
    // since `runGit` is real and only cares about the URL string it's given via a local override
    // seam below.
    const result = await ensureAdaDeliveryPush({
      workspacePath: workspace.path,
      repository: "unused-in-this-test",
      deliveryBranch: "ada/exec-request-1",
      deliveryCommitSha: workspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: (params) => runGit({ ...params, args: params.args.map((arg) => arg.replace("https://github.com/unused-in-this-test.git", bareRemotePath)) }),
      mintCredential: fakeMintOk,
    });

    // Assert
    expect(result).toEqual({ ok: true, remoteBranch: "ada/exec-request-1", remoteSha: workspace.commitSha });

    const remoteRefs = execFileSync("git", ["ls-remote", bareRemotePath, "refs/heads/ada/exec-request-1"], {
      encoding: "utf8",
    }).trim();
    expect(remoteRefs).toContain(workspace.commitSha);
  });

  it("does not execute a repository-controlled client-side pre-push hook", async () => {
    // Arrange
    const bareRemotePath = await createBareRemoteFixture();
    const workspace = await createWorkspaceFixture();
    cleanupPaths.push(bareRemotePath, workspace.path);
    const markerPath = await installPrePushHookMarker(workspace.path);

    // Act
    const result = await ensureAdaDeliveryPush({
      workspacePath: workspace.path,
      repository: "unused-in-this-test",
      deliveryBranch: "ada/exec-request-1",
      deliveryCommitSha: workspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: (params) => runGit({ ...params, args: params.args.map((arg) => arg.replace("https://github.com/unused-in-this-test.git", bareRemotePath)) }),
      mintCredential: fakeMintOk,
    });

    // Assert — `--no-verify` must prevent the workspace's own `pre-push` hook from running; if it
    // had run, the marker file would exist.
    expect(result.ok).toBe(true);
    await expect(rm(markerPath, { force: false })).rejects.toThrow();
  });

  it("second push of the same already-published SHA succeeds and re-verifies (idempotent, no force needed)", async () => {
    // Arrange
    const bareRemotePath = await createBareRemoteFixture();
    const workspace = await createWorkspaceFixture();
    cleanupPaths.push(bareRemotePath, workspace.path);
    const runGitAgainstFixture = (params: Parameters<typeof runGit>[0]) =>
      runGit({ ...params, args: params.args.map((arg) => arg.replace("https://github.com/unused-in-this-test.git", bareRemotePath)) });

    const first = await ensureAdaDeliveryPush({
      workspacePath: workspace.path,
      repository: "unused-in-this-test",
      deliveryBranch: "ada/exec-request-1",
      deliveryCommitSha: workspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: runGitAgainstFixture,
      mintCredential: fakeMintOk,
    });
    expect(first.ok).toBe(true);

    // Act
    const second = await ensureAdaDeliveryPush({
      workspacePath: workspace.path,
      repository: "unused-in-this-test",
      deliveryBranch: "ada/exec-request-1",
      deliveryCommitSha: workspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: runGitAgainstFixture,
      mintCredential: fakeMintOk,
    });

    // Assert
    expect(second).toEqual({ ok: true, remoteBranch: "ada/exec-request-1", remoteSha: workspace.commitSha });
  });

  it("fails safely without force-overwriting when the remote branch has diverged", async () => {
    // Arrange
    const bareRemotePath = await createBareRemoteFixture();
    const workspace = await createWorkspaceFixture();
    cleanupPaths.push(bareRemotePath, workspace.path);
    const runGitAgainstFixture = (params: Parameters<typeof runGit>[0]) =>
      runGit({ ...params, args: params.args.map((arg) => arg.replace("https://github.com/unused-in-this-test.git", bareRemotePath)) });

    const first = await ensureAdaDeliveryPush({
      workspacePath: workspace.path,
      repository: "unused-in-this-test",
      deliveryBranch: "ada/exec-request-1",
      deliveryCommitSha: workspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: runGitAgainstFixture,
      mintCredential: fakeMintOk,
    });
    expect(first.ok).toBe(true);

    // Diverge: a second, unrelated workspace also publishes to the same branch first.
    const divergentWorkspace = await createWorkspaceFixture("divergent");
    cleanupPaths.push(divergentWorkspace.path);
    const runGitAgainstFixtureForDivergent = (params: Parameters<typeof runGit>[0]) =>
      runGit({ ...params, args: params.args.map((arg) => arg.replace("https://github.com/unused-in-this-test.git", bareRemotePath)) });
    const divergentPush = await ensureAdaDeliveryPush({
      workspacePath: divergentWorkspace.path,
      repository: "unused-in-this-test",
      deliveryBranch: "ada/exec-request-1",
      deliveryCommitSha: divergentWorkspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: runGitAgainstFixtureForDivergent,
      mintCredential: fakeMintOk,
    });
    expect(divergentPush.ok).toBe(false);

    // Assert: the remote must still hold the *first* SHA — never force-overwritten.
    const remoteRefs = execFileSync("git", ["ls-remote", bareRemotePath, "refs/heads/ada/exec-request-1"], {
      encoding: "utf8",
    }).trim();
    expect(remoteRefs).toContain(workspace.commitSha);
    expect(remoteRefs).not.toContain(divergentWorkspace.commitSha);
  });

  it("uses the credential from mintCredential — never falling back to an ambient/system credential", async () => {
    // Arrange
    const bareRemotePath = await createBareRemoteFixture();
    const workspace = await createWorkspaceFixture();
    cleanupPaths.push(bareRemotePath, workspace.path);
    let mintCalls = 0;
    const trackingMint: MintGithubDeliveryCredential = async () => {
      mintCalls += 1;
      return { ok: true, token: "integration-test-token", expiresAt: "2026-09-23T13:00:00Z" };
    };

    // Act
    const result = await ensureAdaDeliveryPush({
      workspacePath: workspace.path,
      repository: "unused-in-this-test",
      deliveryBranch: "ada/exec-request-1",
      deliveryCommitSha: workspace.commitSha,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      runGit: (params) => runGit({ ...params, args: params.args.map((arg) => arg.replace("https://github.com/unused-in-this-test.git", bareRemotePath)) }),
      mintCredential: trackingMint,
    });

    // Assert
    expect(result.ok).toBe(true);
    expect(mintCalls).toBe(1);
  });
});
