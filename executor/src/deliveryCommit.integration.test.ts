import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureAdaDeliveryCommit } from "./deliveryCommit";
import { runGit } from "./gitProcess";

/** Builds a local temp git repository with a single committed file on `develop`, then checks out a delivery branch from it — mirroring the workspace state `runExecutor` hands to this capability. */
async function createFixtureRepository(): Promise<{ path: string; headSha: string; deliveryBranch: string }> {
  const path = await mkdtemp(join(tmpdir(), "ada-executor-delivery-commit-fixture-"));
  const run = (args: string[]) => execFileSync("git", args, { cwd: path, encoding: "utf8" }).trim();

  run(["init", "--initial-branch=develop"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  await writeFile(join(path, "README.md"), "hello\n");
  await writeFile(join(path, "tracked-for-deletion.txt"), "will be deleted\n");
  run(["add", "README.md", "tracked-for-deletion.txt"]);
  run(["commit", "-m", "initial commit"]);
  const headSha = run(["rev-parse", "HEAD"]);

  const deliveryBranch = "ada/exec-request-1";
  run(["checkout", "-b", deliveryBranch]);

  return { path, headSha, deliveryBranch };
}

describe("ensureAdaDeliveryCommit against a real git workspace", () => {
  const fixturePaths: string[] = [];

  afterEach(async () => {
    await Promise.all(fixturePaths.map((path) => rm(path, { recursive: true, force: true })));
    fixturePaths.length = 0;
  });

  it("commits tracked modifications, tracked deletions, and untracked files, leaving a clean tree", async () => {
    // Arrange
    const { path: workspacePath, headSha, deliveryBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await writeFile(join(workspacePath, "README.md"), "modified by the coding agent\n");
    await writeFile(join(workspacePath, "new-file.ts"), "export {};\n");
    await rm(join(workspacePath, "tracked-for-deletion.txt"));

    // Act
    const outcome = await ensureAdaDeliveryCommit({
      workspacePath,
      executionRequestId: "exec-request-1",
      expectedBranch: deliveryBranch,
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

  it("creates the commit on the delivery branch as a direct child of the persisted sourceRevision.headSha", async () => {
    // Arrange
    const { path: workspacePath, headSha, deliveryBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await writeFile(join(workspacePath, "new-file.ts"), "export {};\n");

    // Act
    const outcome = await ensureAdaDeliveryCommit({
      workspacePath,
      executionRequestId: "exec-request-1",
      expectedBranch: deliveryBranch,
      expectedParentSha: headSha,
      runGit,
    });

    // Assert
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const branchOutcome = await runGit({ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: workspacePath });
    expect(branchOutcome).toEqual({ ok: true, stdout: `${deliveryBranch}\n` });

    const parentOutcome = await runGit({ args: ["rev-parse", `${outcome.commitSha}^`], cwd: workspacePath });
    expect(parentOutcome).toEqual({ ok: true, stdout: `${headSha}\n` });
  });

  it("commits with the ADA-controlled author/committer identity, never the fixture's own git identity", async () => {
    // Arrange
    const { path: workspacePath, headSha, deliveryBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await writeFile(join(workspacePath, "new-file.ts"), "export {};\n");

    // Act
    const outcome = await ensureAdaDeliveryCommit({
      workspacePath,
      executionRequestId: "exec-request-1",
      expectedBranch: deliveryBranch,
      expectedParentSha: headSha,
      runGit,
    });

    // Assert
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const authorOutcome = await runGit({
      args: ["log", "-1", "--format=%an <%ae>", outcome.commitSha],
      cwd: workspacePath,
    });
    expect(authorOutcome).toEqual({ ok: true, stdout: "ADA Delivery Engine <ada-delivery-engine@ada.local>\n" });
  });

  it("does not invoke a repository-controlled commit-msg hook that would fail the commit", async () => {
    // Arrange
    const { path: workspacePath, headSha, deliveryBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    // A hostile repo-controlled hook that always rejects the commit if hooks are honored.
    await writeFile(
      join(workspacePath, ".git", "hooks", "commit-msg"),
      "#!/bin/sh\necho 'blocked by repository-controlled hook' >&2\nexit 1\n",
      { mode: 0o755 },
    );
    await writeFile(join(workspacePath, "new-file.ts"), "export {};\n");

    // Act
    const outcome = await ensureAdaDeliveryCommit({
      workspacePath,
      executionRequestId: "exec-request-1",
      expectedBranch: deliveryBranch,
      expectedParentSha: headSha,
      runGit,
    });

    // Assert
    expect(outcome.ok).toBe(true);
  });

  it("still cleans up the caller-owned workspace afterward (cleanup is the caller's responsibility, proven reachable)", async () => {
    // Arrange
    const { path: workspacePath, headSha, deliveryBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await writeFile(join(workspacePath, "new-file.ts"), "export {};\n");

    // Act
    const outcome = await ensureAdaDeliveryCommit({
      workspacePath,
      executionRequestId: "exec-request-1",
      expectedBranch: deliveryBranch,
      expectedParentSha: headSha,
      runGit,
    });
    expect(outcome.ok).toBe(true);
    await rm(workspacePath, { recursive: true, force: true });

    // Assert — cleanup succeeds without throwing after this capability has run.
    await expect(rm(workspacePath, { recursive: true, force: true })).resolves.toBeUndefined();
  });

  it("returns a safe parent_mismatch failure when the branch's actual parent is not the persisted sourceRevision.headSha", async () => {
    // Arrange
    const { path: workspacePath, deliveryBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);
    await writeFile(join(workspacePath, "new-file.ts"), "export {};\n");
    const wrongParentSha = "a".repeat(40);

    // Act
    const outcome = await ensureAdaDeliveryCommit({
      workspacePath,
      executionRequestId: "exec-request-1",
      expectedBranch: deliveryBranch,
      expectedParentSha: wrongParentSha,
      runGit,
    });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("parent_mismatch");
  });

  it("fails safely with a git exit code, and no raw stderr, when there are no changes to stage", async () => {
    // Arrange
    const { path: workspacePath, headSha, deliveryBranch } = await createFixtureRepository();
    fixturePaths.push(workspacePath);

    // Act
    const outcome = await ensureAdaDeliveryCommit({
      workspacePath,
      executionRequestId: "exec-request-1",
      expectedBranch: deliveryBranch,
      expectedParentSha: headSha,
      runGit,
    });

    // Assert
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe("commit_failed");
    expect(outcome).not.toHaveProperty("stderr");
  });
});
