import { describe, expect, it } from "vitest";

import {
  createDeliveryCommit,
  deriveDeliveryCommitMessage,
  ensureAdaDeliveryCommit,
  resolveDeliveryCommitSha,
  stageDeliveryChanges,
  verifyDeliveryCommit,
} from "./deliveryCommit";

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

describe("deriveDeliveryCommitMessage", () => {
  it("derives the same message for the same executionRequestId every time", () => {
    // Act
    const first = deriveDeliveryCommitMessage("exec-request-1");
    const second = deriveDeliveryCommitMessage("exec-request-1");

    // Assert
    expect(first).toBe(second);
  });

  it("derives different messages for different executionRequestIds", () => {
    // Act
    const first = deriveDeliveryCommitMessage("exec-request-1");
    const second = deriveDeliveryCommitMessage("exec-request-2");

    // Assert
    expect(first).not.toBe(second);
  });

  it("uses a fixed deterministic format with the executionRequestId as the only variable component", () => {
    // Act
    const message = deriveDeliveryCommitMessage("exec-request-1");

    // Assert
    expect(message).toBe("ADA delivery commit for execution request exec-request-1");
  });

  it("takes only executionRequestId — there is no parameter for task title, prompt, or repository content", () => {
    // Assert (type-level proof: calling with a second argument is a compile error, not a runtime behavior)
    expect(deriveDeliveryCommitMessage.length).toBe(1);
  });
});

describe("stageDeliveryChanges", () => {
  it("stages the complete working-tree delta via git add -A with option termination and an explicit pathspec", async () => {
    // Arrange
    const { runGit, calls } = recordingRunGit("");

    // Act
    const outcome = await stageDeliveryChanges({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: true });
    expect(calls).toEqual([{ args: ["add", "-A", "--", "."], cwd: "/workspace" }]);
  });

  it("never runs commit, reset, clean, or stash while staging", async () => {
    // Arrange
    const { runGit, calls } = recordingRunGit("");

    // Act
    await stageDeliveryChanges({ workspacePath: "/workspace", runGit });

    // Assert
    const subcommands = calls.map((call) => call.args[0]);
    expect(subcommands).toEqual(["add"]);
  });

  it("returns a safe failure with the git exit code, and never the raw stderr, when staging fails", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: 128 });

    // Act
    const outcome = await stageDeliveryChanges({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "staging_failed", gitErrorCode: 128 });
    expect(outcome).not.toHaveProperty("stderr");
  });
});

describe("createDeliveryCommit", () => {
  it("commits via invocation-scoped author/committer config, never persistent git config", async () => {
    // Arrange
    const { runGit, calls } = recordingRunGit("");

    // Act
    const outcome = await createDeliveryCommit({
      workspacePath: "/workspace",
      message: "ADA delivery commit for execution request exec-request-1",
      runGit,
    });

    // Assert
    expect(outcome).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        args: [
          "-c",
          "user.name=ADA Delivery Engine",
          "-c",
          "user.email=ada-delivery-engine@ada.local",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "--no-verify",
          "-m",
          "ADA delivery commit for execution request exec-request-1",
        ],
        cwd: "/workspace",
      },
    ]);
  });

  it("passes --no-verify so repository-controlled pre-commit/commit-msg hooks cannot silently run", async () => {
    // Arrange
    const { runGit, calls } = recordingRunGit("");

    // Act
    await createDeliveryCommit({ workspacePath: "/workspace", message: "msg", runGit });

    // Assert
    expect(calls[0]?.args).toContain("--no-verify");
  });

  it("disables gpg signing for this invocation only, never mutating persistent config", async () => {
    // Arrange
    const { runGit, calls } = recordingRunGit("");

    // Act
    await createDeliveryCommit({ workspacePath: "/workspace", message: "msg", runGit });

    // Assert
    expect(calls[0]?.args).toEqual(expect.arrayContaining(["-c", "commit.gpgsign=false"]));
    expect(calls.map((call) => call.args[0])).toEqual(["-c"]);
    expect(calls.some((call) => call.args.includes("config"))).toBe(false);
  });

  it("passes the commit message as its own argv element to -m, never shell-interpolated", async () => {
    // Arrange
    const { runGit, calls } = recordingRunGit("");
    const message = "ADA delivery commit for execution request exec-request-1";

    // Act
    await createDeliveryCommit({ workspacePath: "/workspace", message, runGit });

    // Assert
    const messageIndex = calls[0]?.args.indexOf("-m");
    expect(calls[0]?.args[(messageIndex ?? -1) + 1]).toBe(message);
  });

  it("returns a safe failure with the git exit code, and never the raw stderr, when the commit fails", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: 1 });

    // Act
    const outcome = await createDeliveryCommit({ workspacePath: "/workspace", message: "msg", runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "commit_failed", gitErrorCode: 1 });
    expect(outcome).not.toHaveProperty("stderr");
  });
});

describe("resolveDeliveryCommitSha", () => {
  it("resolves HEAD to the commit SHA", async () => {
    // Arrange
    const runGit = fakeRunGit({ stdout: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n" });

    // Act
    const outcome = await resolveDeliveryCommitSha({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: true, commitSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" });
  });

  it("uses git rev-parse HEAD scoped to the workspace path", async () => {
    // Arrange
    const { runGit, calls } = recordingRunGit("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n");

    // Act
    await resolveDeliveryCommitSha({ workspacePath: "/workspace", runGit });

    // Assert
    expect(calls).toEqual([{ args: ["rev-parse", "HEAD"], cwd: "/workspace" }]);
  });

  it("returns a safe failure with the git exit code, and never the raw stderr, when resolution fails", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: 128 });

    // Act
    const outcome = await resolveDeliveryCommitSha({ workspacePath: "/workspace", runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "resolution_failed", gitErrorCode: 128 });
    expect(outcome).not.toHaveProperty("stderr");
  });
});

describe("verifyDeliveryCommit", () => {
  const baseRequest = {
    workspacePath: "/workspace",
    expectedCommitSha: "c".repeat(40),
    expectedBranch: "ada/exec-request-1",
    expectedParentSha: "a".repeat(40),
  };

  it("succeeds when HEAD, the checked-out branch, and the commit's parent all match", async () => {
    // Arrange
    const runGit: RunGit = async (params) => {
      if (params.args[0] === "rev-parse" && params.args[1] === "HEAD") {
        return { ok: true, stdout: `${baseRequest.expectedCommitSha}\n` };
      }
      if (params.args[0] === "rev-parse" && params.args[1] === "--abbrev-ref") {
        return { ok: true, stdout: `${baseRequest.expectedBranch}\n` };
      }
      // parent resolution: git rev-parse <sha>^
      return { ok: true, stdout: `${baseRequest.expectedParentSha}\n` };
    };

    // Act
    const outcome = await verifyDeliveryCommit({ ...baseRequest, runGit });

    // Assert
    expect(outcome).toEqual({ ok: true });
  });

  it("resolves the parent using <commitSha>^ scoped to the workspace path", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      if (params.args[1] === "HEAD") return { ok: true, stdout: `${baseRequest.expectedCommitSha}\n` };
      if (params.args[1] === "--abbrev-ref") return { ok: true, stdout: `${baseRequest.expectedBranch}\n` };
      return { ok: true, stdout: `${baseRequest.expectedParentSha}\n` };
    };

    // Act
    await verifyDeliveryCommit({ ...baseRequest, runGit });

    // Assert
    expect(calls).toContainEqual({ args: ["rev-parse", `${baseRequest.expectedCommitSha}^`], cwd: "/workspace" });
  });

  it("returns a safe head_mismatch failure when HEAD no longer matches the resolved commit SHA", async () => {
    // Arrange
    const runGit: RunGit = async (params) => {
      if (params.args[1] === "HEAD") return { ok: true, stdout: `${"f".repeat(40)}\n` };
      if (params.args[1] === "--abbrev-ref") return { ok: true, stdout: `${baseRequest.expectedBranch}\n` };
      return { ok: true, stdout: `${baseRequest.expectedParentSha}\n` };
    };

    // Act
    const outcome = await verifyDeliveryCommit({ ...baseRequest, runGit });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "head_mismatch",
      expectedCommitSha: baseRequest.expectedCommitSha,
      actualHeadSha: "f".repeat(40),
    });
  });

  it("returns a safe branch_mismatch failure when the checked-out branch differs from the delivery branch", async () => {
    // Arrange
    const runGit: RunGit = async (params) => {
      if (params.args[1] === "HEAD") return { ok: true, stdout: `${baseRequest.expectedCommitSha}\n` };
      if (params.args[1] === "--abbrev-ref") return { ok: true, stdout: "some-other-branch\n" };
      return { ok: true, stdout: `${baseRequest.expectedParentSha}\n` };
    };

    // Act
    const outcome = await verifyDeliveryCommit({ ...baseRequest, runGit });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "branch_mismatch",
      expectedBranch: baseRequest.expectedBranch,
      actualBranch: "some-other-branch",
    });
  });

  it("returns a safe parent_mismatch failure when the commit's parent is not the persisted sourceRevision.headSha", async () => {
    // Arrange
    const runGit: RunGit = async (params) => {
      if (params.args[1] === "HEAD") return { ok: true, stdout: `${baseRequest.expectedCommitSha}\n` };
      if (params.args[1] === "--abbrev-ref") return { ok: true, stdout: `${baseRequest.expectedBranch}\n` };
      return { ok: true, stdout: `${"e".repeat(40)}\n` };
    };

    // Act
    const outcome = await verifyDeliveryCommit({ ...baseRequest, runGit });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "parent_mismatch",
      expectedParentSha: baseRequest.expectedParentSha,
      actualParentSha: "e".repeat(40),
    });
  });

  it("returns a safe inspection_failed failure with stage and git exit code, and never raw stderr, when HEAD resolution fails", async () => {
    // Arrange
    const runGit = fakeRunGit({ ok: false, code: 128 });

    // Act
    const outcome = await verifyDeliveryCommit({ ...baseRequest, runGit });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "inspection_failed",
      stage: "resolve_head",
      gitErrorCode: 128,
    });
    expect(outcome).not.toHaveProperty("stderr");
  });

  it("never attempts branch or parent resolution when HEAD resolution fails", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      return { ok: false, stderr: "unsafe detail", code: 128 };
    };

    // Act
    await verifyDeliveryCommit({ ...baseRequest, runGit });

    // Assert
    expect(calls).toHaveLength(1);
  });
});

describe("ensureAdaDeliveryCommit", () => {
  const request = {
    workspacePath: "/workspace",
    executionRequestId: "exec-request-1",
    expectedBranch: "ada/exec-request-1",
    expectedParentSha: "a".repeat(40),
  };

  function successfulRunGit(commitSha: string): RunGit {
    return async (params) => {
      if (params.args[0] === "add") return { ok: true, stdout: "" };
      if (params.args.includes("commit")) return { ok: true, stdout: "" };
      if (params.args[0] === "rev-parse" && params.args[1] === "HEAD") return { ok: true, stdout: `${commitSha}\n` };
      if (params.args[0] === "rev-parse" && params.args[1] === "--abbrev-ref") {
        return { ok: true, stdout: `${request.expectedBranch}\n` };
      }
      if (params.args[0] === "rev-parse") return { ok: true, stdout: `${request.expectedParentSha}\n` };
      return { ok: true, stdout: "" };
    };
  }

  it("stages, commits, resolves, and verifies, returning the commit SHA on success", async () => {
    // Arrange
    const commitSha = "c".repeat(40);
    const runGit = successfulRunGit(commitSha);

    // Act
    const outcome = await ensureAdaDeliveryCommit({ ...request, runGit });

    // Assert
    expect(outcome).toEqual({ ok: true, commitSha });
  });

  it("runs staging before committing, and committing before resolving/verifying", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const commitSha = "c".repeat(40);
    const inner = successfulRunGit(commitSha);
    const runGit: RunGit = async (params) => {
      calls.push(params);
      return inner(params);
    };

    // Act
    await ensureAdaDeliveryCommit({ ...request, runGit });

    // Assert
    expect(calls[0]?.args[0]).toBe("add");
    expect(calls[1]?.args).toContain("commit");
  });

  it("returns a safe failure and never attempts to commit when staging fails", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      if (params.args[0] === "add") return { ok: false, stderr: "unsafe detail", code: 128 };
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureAdaDeliveryCommit({ ...request, runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "staging_failed", gitErrorCode: 128 });
    expect(calls).toHaveLength(1);
  });

  it("returns a safe failure and never attempts to resolve the SHA when the commit fails", async () => {
    // Arrange
    const calls: RunGitParams[] = [];
    const runGit: RunGit = async (params) => {
      calls.push(params);
      if (params.args[0] === "add") return { ok: true, stdout: "" };
      if (params.args.includes("commit")) return { ok: false, stderr: "unsafe detail", code: 1 };
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureAdaDeliveryCommit({ ...request, runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "commit_failed", gitErrorCode: 1 });
    expect(calls).toHaveLength(2);
  });

  it("returns a safe failure when SHA resolution fails after a successful commit", async () => {
    // Arrange
    const runGit: RunGit = async (params) => {
      if (params.args[0] === "add") return { ok: true, stdout: "" };
      if (params.args.includes("commit")) return { ok: true, stdout: "" };
      if (params.args[0] === "rev-parse" && params.args[1] === "HEAD") {
        return { ok: false, stderr: "unsafe detail", code: 128 };
      }
      return { ok: true, stdout: "" };
    };

    // Act
    const outcome = await ensureAdaDeliveryCommit({ ...request, runGit });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "resolution_failed", gitErrorCode: 128 });
  });

  it("returns a safe failure when post-commit verification reports a mismatch", async () => {
    // Arrange
    const commitSha = "c".repeat(40);
    const runGit: RunGit = async (params) => {
      if (params.args[0] === "add") return { ok: true, stdout: "" };
      if (params.args.includes("commit")) return { ok: true, stdout: "" };
      if (params.args[0] === "rev-parse" && params.args[1] === "HEAD") return { ok: true, stdout: `${commitSha}\n` };
      if (params.args[0] === "rev-parse" && params.args[1] === "--abbrev-ref") {
        return { ok: true, stdout: "some-other-branch\n" };
      }
      return { ok: true, stdout: `${request.expectedParentSha}\n` };
    };

    // Act
    const outcome = await ensureAdaDeliveryCommit({ ...request, runGit });

    // Assert
    expect(outcome).toEqual({
      ok: false,
      reason: "branch_mismatch",
      expectedBranch: request.expectedBranch,
      actualBranch: "some-other-branch",
    });
  });

  it("never includes raw stderr or the workspace path in any failure outcome", async () => {
    // Arrange
    const runGit: RunGit = async () => ({ ok: false, stderr: "fatal: unsafe stderr detail", code: 1 });

    // Act
    const outcome = await ensureAdaDeliveryCommit({
      workspacePath: "/some/unsafe/workspace-path",
      executionRequestId: "exec-request-1",
      expectedBranch: "ada/exec-request-1",
      expectedParentSha: "a".repeat(40),
      runGit,
    });

    // Assert
    expect(JSON.stringify(outcome)).not.toContain("/some/unsafe/workspace-path");
    expect(JSON.stringify(outcome)).not.toContain("unsafe stderr detail");
  });
});
