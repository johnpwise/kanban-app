import { describe, expect, it } from "vitest";

import {
  createDeliveryBranch,
  deriveDeliveryBranchName,
  ensureAdaDeliveryBranch,
  validateGitBranchName,
  verifyDeliveryBranch,
} from "./deliveryBranch";

import type { RunGit, RunGitParams } from "./gitProcess";

function fakeRunGit(behavior: { stdout?: string; ok?: boolean; code?: number | string | null }): RunGit {
  return async () => {
    if (behavior.ok === false) {
      return { ok: false, stderr: "fatal: unsafe stderr detail that must never be logged", code: behavior.code ?? 128 };
    }
    return { ok: true, stdout: behavior.stdout ?? "" };
  };
}

function recordingRunGit(outcomeByStdout: string): { runGit: RunGit; calls: RunGitParams[] } {
  const calls: RunGitParams[] = [];
  return {
    calls,
    runGit: async (params) => {
      calls.push(params);
      return { ok: true, stdout: outcomeByStdout };
    },
  };
}

describe("deriveDeliveryBranchName", () => {
  it("derives the same branch name for the same executionRequestId every time", () => {
    // Act
    const first = deriveDeliveryBranchName("exec-request-1");
    const second = deriveDeliveryBranchName("exec-request-1");

    // Assert
    expect(first).toBe(second);
  });

  it("derives different branch names for different executionRequestIds", () => {
    // Act
    const first = deriveDeliveryBranchName("exec-request-1");
    const second = deriveDeliveryBranchName("exec-request-2");

    // Assert
    expect(first).not.toBe(second);
  });

  it("uses the ada/ namespace with the executionRequestId as the only variable component", () => {
    // Act
    const branchName = deriveDeliveryBranchName("exec-request-1");

    // Assert
    expect(branchName).toBe("ada/exec-request-1");
  });

  it("takes only executionRequestId — there is no parameter for task title or prompt", () => {
    // Assert (type-level proof: calling with a second argument is a compile error, not a runtime behavior)
    expect(deriveDeliveryBranchName.length).toBe(1);
  });
});

describe("validateGitBranchName", () => {
  it("accepts the derived ada/<executionRequestId> shape", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: true });

    // Act
    const outcome = await validateGitBranchName({ branchName: "ada/exec-request-1", runGit });

    // Assert
    expect(outcome).toEqual({ ok: true });
  });

  it("validates using git's own check-ref-format against refs/heads/<branchName>", async () => {
    // Arrange
    const { runGit, calls } = recordingRunGit("");

    // Act
    await validateGitBranchName({ branchName: "ada/exec-request-1", runGit });

    // Assert
    expect(calls).toEqual([{ args: ["check-ref-format", "refs/heads/ada/exec-request-1"] }]);
  });

  it("returns a safe failure with the git exit code, and never the raw stderr, for an invalid ref", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: 1 });

    // Act
    const outcome = await validateGitBranchName({ branchName: "ada/..", runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "invalid_ref_format", gitErrorCode: 1 });
    expect(outcome).not.toHaveProperty("stderr");
  });
});

describe("createDeliveryBranch", () => {
  it("creates and checks out the branch via git checkout -b, with the branch name as its own argv element", async () => {
    // Arrange
    const { runGit, calls } = recordingRunGit("");

    // Act
    const outcome = await createDeliveryBranch({ workspacePath: "/workspace", branchName: "ada/exec-request-1", runGit });

    // Assert
    expect(outcome).toEqual({ ok: true });
    expect(calls).toEqual([{ args: ["checkout", "-b", "ada/exec-request-1"], cwd: "/workspace" }]);
  });

  it("never runs add, commit, reset, clean, or stash", async () => {
    // Arrange
    const { runGit, calls } = recordingRunGit("");

    // Act
    await createDeliveryBranch({ workspacePath: "/workspace", branchName: "ada/exec-request-1", runGit });

    // Assert
    const subcommands = calls.map((call) => call.args[0]);
    expect(subcommands).toEqual(["checkout"]);
  });

  it("returns a safe failure with the git exit code, and never the raw stderr, when git checkout fails", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: 128 });

    // Act
    const outcome = await createDeliveryBranch({ workspacePath: "/workspace", branchName: "ada/exec-request-1", runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "branch_creation_failed", gitErrorCode: 128 });
    expect(outcome).not.toHaveProperty("stderr");
  });
});

describe("verifyDeliveryBranch", () => {
  it("succeeds when the checked-out branch matches the expected branch", async () => {
    // Arrange
    const runGit = fakeRunGit({ stdout: "ada/exec-request-1\n" });

    // Act
    const outcome = await verifyDeliveryBranch({ workspacePath: "/workspace", expectedBranch: "ada/exec-request-1", runGit });

    // Assert
    expect(outcome).toEqual({ ok: true });
  });

  it("uses git rev-parse --abbrev-ref HEAD scoped to the workspace path", async () => {
    // Arrange
    const { runGit, calls } = recordingRunGit("ada/exec-request-1\n");

    // Act
    await verifyDeliveryBranch({ workspacePath: "/workspace", expectedBranch: "ada/exec-request-1", runGit });

    // Assert
    expect(calls).toEqual([{ args: ["rev-parse", "--abbrev-ref", "HEAD"], cwd: "/workspace" }]);
  });

  it("returns a safe mismatch failure, with only branch identifiers, when the checked-out branch differs", async () => {
    // Arrange
    const runGit = fakeRunGit({ stdout: "some-other-branch\n" });

    // Act
    const outcome = await verifyDeliveryBranch({ workspacePath: "/workspace", expectedBranch: "ada/exec-request-1", runGit });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "branch_mismatch",
      expectedBranch: "ada/exec-request-1",
      actualBranch: "some-other-branch",
    });
  });

  it("returns a safe failure with the git exit code, and never the raw stderr, when inspection fails", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: 128 });

    // Act
    const outcome = await verifyDeliveryBranch({ workspacePath: "/workspace", expectedBranch: "ada/exec-request-1", runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "inspection_failed", gitErrorCode: 128 });
    expect(outcome).not.toHaveProperty("stderr");
  });
});

describe("ensureAdaDeliveryBranch", () => {
  it("derives, validates, creates, and verifies the delivery branch, returning its name on success", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      if (params.args[0] === "rev-parse") {
        return { ok: true, stdout: "ada/exec-request-1\n" };
      }
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureAdaDeliveryBranch({
      workspacePath: "/workspace",
      executionRequestId: "exec-request-1",
      runGit,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, branchName: "ada/exec-request-1" });
    expect(calls.map((call) => call.args[0])).toEqual(["check-ref-format", "checkout", "rev-parse"]);
  });

  it("returns a safe failure and never attempts creation when validation fails", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      if (params.args[0] === "check-ref-format") {
        return { ok: false, stderr: "unsafe detail", code: 1 };
      }
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureAdaDeliveryBranch({
      workspacePath: "/workspace",
      executionRequestId: "exec-request-1",
      runGit,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "invalid_branch_name", gitErrorCode: 1 });
    expect(calls.map((call) => call.args[0])).toEqual(["check-ref-format"]);
  });

  it("returns a safe failure and never attempts verification when branch creation fails", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      if (params.args[0] === "checkout") {
        return { ok: false, stderr: "unsafe detail", code: 128 };
      }
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureAdaDeliveryBranch({
      workspacePath: "/workspace",
      executionRequestId: "exec-request-1",
      runGit,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "branch_creation_failed", gitErrorCode: 128 });
    expect(calls.map((call) => call.args[0])).toEqual(["check-ref-format", "checkout"]);
  });

  it("returns a safe failure when the checked-out branch does not verify as the delivery branch", async () => {
    // Arrange
    const runGit: RunGit = async (params) => {
      if (params.args[0] === "rev-parse") {
        return { ok: true, stdout: "coding-agent-branch\n" };
      }
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureAdaDeliveryBranch({
      workspacePath: "/workspace",
      executionRequestId: "exec-request-1",
      runGit,
    });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "branch_verification_failed",
      expectedBranch: "ada/exec-request-1",
      actualBranch: "coding-agent-branch",
    });
  });

  it("returns a safe failure when branch verification inspection itself fails", async () => {
    // Arrange
    const runGit: RunGit = async (params) => {
      if (params.args[0] === "rev-parse") {
        return { ok: false, stderr: "unsafe detail", code: 128 };
      }
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureAdaDeliveryBranch({
      workspacePath: "/workspace",
      executionRequestId: "exec-request-1",
      runGit,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "branch_verification_inspection_failed", gitErrorCode: 128 });
    expect(outcome).not.toHaveProperty("stderr");
  });

  it("never includes raw stderr, the workspace path, or the executionRequestId's git error detail in a failure outcome", async () => {
    // Arrange
    const runGit: RunGit = async () => ({ ok: false, stderr: "fatal: unsafe stderr detail", code: 1 });

    // Act
    const outcome = await ensureAdaDeliveryBranch({
      workspacePath: "/some/unsafe/workspace-path",
      executionRequestId: "exec-request-1",
      runGit,
    });

    // Assert
    expect(JSON.stringify(outcome)).not.toContain("/some/unsafe/workspace-path");
    expect(JSON.stringify(outcome)).not.toContain("unsafe stderr detail");
  });
});
