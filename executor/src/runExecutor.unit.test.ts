import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { ProcessCodingAgentRuntimeError } from "./processCodingAgentRuntime";
import { runExecutor } from "./runExecutor";
import { createFakeEnsureAdaDeliveryBranch } from "./testHelpers/fakeEnsureAdaDeliveryBranch";
import { createFakeEnsureAdaDeliveryCommit } from "./testHelpers/fakeEnsureAdaDeliveryCommit";
import { createFakeEnsureAdaDeliveryPush } from "./testHelpers/fakeEnsureAdaDeliveryPush";
import { createFakeExecutionRunRepository } from "./testHelpers/fakeExecutionRunRepository";
import { createFakeInspectWorkingTree } from "./testHelpers/fakeInspectWorkingTree";
import { createFakeLogger } from "./testHelpers/fakeLogger";
import { createFakeMaterializeRepositoryWorkspace } from "./testHelpers/fakeMaterializeRepositoryWorkspace";
import { createFakeInvokeCodingAgent } from "./testHelpers/fakeInvokeCodingAgent";
import { createFakeVerifyGitIntegrity } from "./testHelpers/fakeVerifyGitIntegrity";

const PROMPT = "Do not leak this prompt text into any log line.";
const TITLE = "Do not leak this title text into any log line.";

function validRunData() {
  return {
    executionRequestId: "req-1",
    correlationId: "corr-1",
    projectId: "project-1",
    cardId: "card-1",
    status: "accepted",
    acceptedAt: Timestamp.now(),
    firstMessageId: "msg-1",
    input: {
      schemaVersion: 1,
      eventType: "ada.execution.requested",
      title: TITLE,
      prompt: PROMPT,
      repository: "johnpwise/kanban-app",
      baseBranch: "develop",
      requestedBy: "user-1",
      requestedAt: "2026-09-20T00:00:00.000Z",
    },
  };
}

function serializedLogs(calls: ReturnType<typeof createFakeLogger>["calls"]) {
  return JSON.stringify(calls);
}

describe("runExecutor", () => {
  it("returns success and claimed:true for a valid configuration and an accepted run", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
  });

  it("passes the execution run id and a generated claim id to the repository's claim call", async () => {
    // Arrange
    const { repository, claimCalls } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
      claimIdFactory: () => "claim-1",
    });

    // Assert
    expect(claimCalls).toEqual([{ executionRunId: "req-1", claimId: "claim-1" }]);
  });

  it("returns ok:true with claimed:false when another executor already owns the claim", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      claim: { claimed: false, reason: "already_claimed" },
    });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, calls } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: false });
    expect(calls).toEqual([]);
  });

  it("logs only safe identifiers when another executor already owns the claim", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      claim: { claimed: false, reason: "already_claimed" },
    });
    const { logger, calls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    const infoCall = calls.find((call) => call.level === "info");
    expect(infoCall?.fields).toMatchObject({
      executionRequestId: "req-1",
      correlationId: "corr-1",
      projectId: "project-1",
      cardId: "card-1",
    });
    expect(serializedLogs(calls)).not.toContain(PROMPT);
    expect(serializedLogs(calls)).not.toContain(TITLE);
  });

  it("does not attempt to claim a run that fails validation", async () => {
    // Arrange
    const { repository, claimCalls } = createFakeExecutionRunRepository({ data: undefined });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(claimCalls).toEqual([]);
  });

  it("returns failure when claiming the execution run throws a transient error, and never materialises the repository", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      claimThrowError: new Error("unavailable"),
    });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, calls } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("loads the run using the exact execution run id from the environment", async () => {
    // Arrange
    const { repository, calls } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(calls).toEqual([{ executionRunId: "req-1" }]);
  });

  it("returns failure for missing/invalid environment configuration", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({ env: {}, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure when the execution run is not found", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: undefined });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure for a malformed execution run document", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: { not: "valid" } });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure when the execution run is not in accepted status", async () => {
    // Arrange
    const data = { ...validRunData(), status: "planning" };
    const { repository } = createFakeExecutionRunRepository({ data });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure when the repository throws a transient error", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ throwError: new Error("unavailable") });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("logs safe identifiers and the checked-out HEAD SHA on success", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    const successCall = calls.find((call) => call.level === "info");
    expect(successCall?.fields).toMatchObject({
      executionRequestId: "req-1",
      correlationId: "corr-1",
      projectId: "project-1",
      cardId: "card-1",
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
  });

  it("never logs the prompt, title, or full execution input", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
    expect(serializedLogs(calls)).not.toContain(TITLE);
  });

  it("never logs the prompt, title, or full input even on a malformed-run failure", async () => {
    // Arrange
    const data = { ...validRunData(), input: { ...validRunData().input, extra: PROMPT } };
    const { repository } = createFakeExecutionRunRepository({ data: { ...data, status: "unknown" } });
    const { logger, calls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
    expect(serializedLogs(calls)).not.toContain(TITLE);
  });

  it("materialises the repository workspace exactly once, using only the immutable input's repository and baseBranch, after winning the claim", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, calls } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(calls).toEqual([{ repository: "johnpwise/kanban-app", baseBranch: "develop" }]);
  });

  it("cleans up the materialised workspace exactly once after a successful checkout", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(cleanupCallCount()).toBe(1);
  });

  it("returns failure with a matching reason when repository materialisation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({ reason: "clone_failed" });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "clone_failed" });
  });

  it("returns failure when repository materialisation throws unexpectedly", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      throwError: new Error("unexpected"),
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("never logs the prompt or title when repository materialisation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({ reason: "checkout_failed" });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
    expect(serializedLogs(calls)).not.toContain(TITLE);
  });

  it("logs the safe git exit code alongside the reason when repository materialisation fails with a git failure", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      reason: "clone_failed",
      gitErrorCode: 128,
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    const errorCall = calls.find(
      (call) => call.level === "error" && call.message === "Failed to materialise the repository workspace.",
    );
    expect(errorCall?.fields).toMatchObject({ reason: "clone_failed", gitErrorCode: 128 });
  });

  it("records the resolved source revision only after a successful repository materialisation", async () => {
    // Arrange
    const { repository, recordSourceRevisionCalls } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
    expect(recordSourceRevisionCalls).toEqual([
      { executionRunId: "req-1", headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
    ]);
  });

  it("does not attempt to record a source revision when repository materialisation fails", async () => {
    // Arrange
    const { repository, recordSourceRevisionCalls } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({ reason: "clone_failed" });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(recordSourceRevisionCalls).toEqual([]);
  });

  it("does not attempt to record a source revision when the execution run is already claimed by another executor", async () => {
    // Arrange
    const { repository, recordSourceRevisionCalls } = createFakeExecutionRunRepository({
      data: validRunData(),
      claim: { claimed: false, reason: "already_claimed" },
    });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(recordSourceRevisionCalls).toEqual([]);
  });

  it("cleans up the workspace exactly once even when recording the source revision fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      recordSourceRevisionThrowError: new Error("unavailable"),
    });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(cleanupCallCount()).toBe(1);
  });

  it("returns failure, not false success, when recording the source revision throws a transient error", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      recordSourceRevisionThrowError: new Error("unavailable"),
    });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "source_revision_error" });
  });

  it("logs the safe identifiers and resolved head SHA when recording the source revision throws a transient error", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      recordSourceRevisionThrowError: new Error("unavailable"),
    });
    const { logger, calls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    const errorCall = calls.find(
      (call) => call.level === "error" && call.message === "Transient failure recording the resolved source revision.",
    );
    expect(errorCall?.fields).toMatchObject({
      executionRequestId: "req-1",
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
  });

  it("returns success when the source revision was already recorded identically (idempotent)", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      recordSourceRevision: { outcome: "already_recorded" },
    });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
  });

  it("returns failure, not false success, when a conflicting source revision is already persisted", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      recordSourceRevision: { outcome: "conflict" },
    });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "source_revision_conflict" });
  });

  it("logs the safe identifiers and resolved head SHA when a conflicting source revision is already persisted", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      recordSourceRevision: { outcome: "conflict" },
    });
    const { logger, calls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    const errorCall = calls.find(
      (call) =>
        call.level === "error" &&
        call.message === "A conflicting source revision is already persisted for this execution run.",
    );
    expect(errorCall?.fields).toMatchObject({
      executionRequestId: "req-1",
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
  });

  it("cleans up the workspace exactly once even when a conflicting source revision is already persisted", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      recordSourceRevision: { outcome: "conflict" },
    });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(cleanupCallCount()).toBe(1);
  });

  it("invokes the coding agent with the execution request id, task, and live workspace, before cleanup runs", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace({
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    let cleanupCallCountAtInvocation = -1;
    const { invokeCodingAgent, calls } = createFakeInvokeCodingAgent({
      onCall: () => {
        cleanupCallCountAtInvocation = cleanupCallCount();
      },
    });

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
      invokeCodingAgent,
    });

    // Assert
    expect(calls).toEqual([
      {
        executionRequestId: "req-1",
        task: { title: TITLE, prompt: PROMPT },
        workspace: { path: "/tmp/fake-workspace", headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
      },
    ]);
    expect(cleanupCallCountAtInvocation).toBe(0);
  });

  it("cleans up the workspace exactly once after the coding agent invocation completes successfully", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { invokeCodingAgent } = createFakeInvokeCodingAgent();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
      invokeCodingAgent,
    });

    // Assert
    expect(cleanupCallCount()).toBe(1);
  });

  it("cleans up the workspace exactly once, and returns a safe failure outcome, when the coding agent invocation throws", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { invokeCodingAgent } = createFakeInvokeCodingAgent({
      throwError: new Error("unsafe coding-agent failure detail"),
    });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
      invokeCodingAgent,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "coding_agent_invocation_error" });
    expect(cleanupCallCount()).toBe(1);
    expect(serializedLogs(logCalls)).not.toContain("unsafe coding-agent failure detail");
  });

  it("logs the safe kind/message of a ProcessCodingAgentRuntimeError when the coding agent invocation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { invokeCodingAgent } = createFakeInvokeCodingAgent({
      throwError: new ProcessCodingAgentRuntimeError("non_zero_exit", "Coding-agent process exited with code 1."),
    });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
      invokeCodingAgent,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "coding_agent_invocation_error" });
    expect(cleanupCallCount()).toBe(1);
    const serialized = serializedLogs(logCalls);
    expect(serialized).toContain("non_zero_exit");
    expect(serialized).toContain("Coding-agent process exited with code 1.");
  });

  it("does not invoke the coding agent when repository materialisation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({ reason: "clone_failed" });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { invokeCodingAgent, calls } = createFakeInvokeCodingAgent();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
      invokeCodingAgent,
    });

    // Assert
    expect(calls).toEqual([]);
  });

  it("does not invoke the coding agent when another executor already owns the claim", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      claim: { claimed: false, reason: "already_claimed" },
    });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { invokeCodingAgent, calls } = createFakeInvokeCodingAgent();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
      invokeCodingAgent,
    });

    // Assert
    expect(calls).toEqual([]);
  });

  it("never logs the prompt or title when recording the source revision fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({
      data: validRunData(),
      recordSourceRevisionThrowError: new Error("unavailable"),
    });
    const { logger, calls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree, verifyGitIntegrity, ensureAdaDeliveryBranch, ensureAdaDeliveryCommit, ensureAdaDeliveryPush });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
    expect(serializedLogs(calls)).not.toContain(TITLE);
  });

  it("verifies git source-control integrity at the still-live workspace path, with the persisted headSha and the immutable baseBranch, after the coding agent invocation succeeds, before cleanup", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace({
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const { invokeCodingAgent } = createFakeInvokeCodingAgent();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    let cleanupCallCountAtVerification = -1;
    const { verifyGitIntegrity, calls } = createFakeVerifyGitIntegrity({
      onCall: () => {
        cleanupCallCountAtVerification = cleanupCallCount();
      },
    });

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      invokeCodingAgent,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(calls).toEqual([
      {
        workspacePath: "/tmp/fake-workspace",
        expectedHeadSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        expectedBranch: "develop",
      },
    ]);
    expect(cleanupCallCountAtVerification).toBe(0);
  });

  it("does not verify git integrity when the coding agent invocation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { invokeCodingAgent } = createFakeInvokeCodingAgent({ throwError: new Error("unsafe detail") });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity, calls } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      invokeCodingAgent,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(calls).toEqual([]);
  });

  it("cleans up the workspace exactly once, does not inspect the working tree, and returns a safe failure outcome, when HEAD has changed", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace({
      headSha: "a".repeat(40),
    });
    const { inspectWorkingTree, calls: workingTreeCalls } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity({
      reason: "head_changed",
      expectedHeadSha: "a".repeat(40),
      actualHeadSha: "b".repeat(40),
    });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "git_integrity_head_changed" });
    expect(cleanupCallCount()).toBe(1);
    expect(workingTreeCalls).toEqual([]);
    const errorCall = logCalls.find((call) => call.level === "error" && call.message.includes("HEAD"));
    expect(errorCall?.fields).toMatchObject({ expectedHeadSha: "a".repeat(40), actualHeadSha: "b".repeat(40) });
  });

  it("cleans up the workspace exactly once, does not inspect the working tree, and returns a safe failure outcome, when the checked-out branch has changed", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree, calls: workingTreeCalls } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity({
      reason: "branch_changed",
      expectedBranch: "develop",
      actualBranch: "coding-agent-branch",
    });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "git_integrity_branch_changed" });
    expect(cleanupCallCount()).toBe(1);
    expect(workingTreeCalls).toEqual([]);
    const errorCall = logCalls.find((call) => call.level === "error" && call.message.includes("branch"));
    expect(errorCall?.fields).toMatchObject({ expectedBranch: "develop", actualBranch: "coding-agent-branch" });
  });

  it("cleans up the workspace exactly once, does not inspect the working tree, and returns a safe failure outcome, when git integrity inspection reports a structured failure", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree, calls: workingTreeCalls } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity({
      reason: "inspection_failed",
      stage: "resolve_head",
      gitErrorCode: 128,
    });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "git_integrity_inspection_failed" });
    expect(cleanupCallCount()).toBe(1);
    expect(workingTreeCalls).toEqual([]);
    const errorCall = logCalls.find((call) => call.level === "error" && call.message.includes("integrity"));
    expect(errorCall?.fields).toMatchObject({ gitErrorCode: 128 });
  });

  it("cleans up the workspace exactly once, does not inspect the working tree, and returns a safe failure outcome, when git integrity verification throws unexpectedly", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree, calls: workingTreeCalls } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity({
      throwError: new Error("unsafe git integrity failure detail"),
    });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "git_integrity_inspection_failed" });
    expect(cleanupCallCount()).toBe(1);
    expect(workingTreeCalls).toEqual([]);
    expect(serializedLogs(logCalls)).not.toContain("unsafe git integrity failure detail");
  });

  it("proves the ordering: coding-agent failure -> NO git integrity verification -> NO working-tree inspection -> cleanup", async () => {
    // Arrange
    const events: string[] = [];
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const wrappedMaterialize: typeof materializeRepositoryWorkspace = async (request) => {
      const outcome = await materializeRepositoryWorkspace(request);
      if (outcome.ok) {
        const cleanup = outcome.cleanup;
        return {
          ...outcome,
          cleanup: async () => {
            events.push("cleanup");
            await cleanup();
          },
        };
      }
      return outcome;
    };
    const { invokeCodingAgent } = createFakeInvokeCodingAgent({
      throwError: new Error("unsafe detail"),
      onCall: () => events.push("coding_agent"),
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ onCall: () => events.push("inspect_working_tree") });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity({ onCall: () => events.push("git_integrity") });

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace: wrappedMaterialize,
      invokeCodingAgent,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(events).toEqual(["coding_agent", "cleanup"]);
  });

  it("proves the ordering: git integrity verification failure -> NO working-tree inspection -> cleanup", async () => {
    // Arrange
    const events: string[] = [];
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const wrappedMaterialize: typeof materializeRepositoryWorkspace = async (request) => {
      const outcome = await materializeRepositoryWorkspace(request);
      if (outcome.ok) {
        const cleanup = outcome.cleanup;
        return {
          ...outcome,
          cleanup: async () => {
            events.push("cleanup");
            await cleanup();
          },
        };
      }
      return outcome;
    };
    const { invokeCodingAgent } = createFakeInvokeCodingAgent({ onCall: () => events.push("coding_agent") });
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ onCall: () => events.push("inspect_working_tree") });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity({
      reason: "head_changed",
      onCall: () => events.push("git_integrity"),
    });

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace: wrappedMaterialize,
      invokeCodingAgent,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(events).toEqual(["coding_agent", "git_integrity", "cleanup"]);
  });

  it("inspects the working tree at the still-live workspace path after the coding agent invocation succeeds, before cleanup", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { invokeCodingAgent } = createFakeInvokeCodingAgent();
    let cleanupCallCountAtInspection = -1;
    const { inspectWorkingTree, calls } = createFakeInspectWorkingTree({
      onCall: () => {
        cleanupCallCountAtInspection = cleanupCallCount();
      },
    });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      invokeCodingAgent,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(calls).toEqual([{ workspacePath: "/tmp/fake-workspace" }]);
    expect(cleanupCallCountAtInspection).toBe(0);
  });

  it("proves the ordering: sourceRevision persisted -> coding agent invoked -> git integrity verified -> working tree inspected -> workspace cleanup", async () => {
    // Arrange
    const events: string[] = [];
    const { repository, recordSourceRevisionCalls } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const wrappedMaterialize: typeof materializeRepositoryWorkspace = async (request) => {
      const outcome = await materializeRepositoryWorkspace(request);
      if (outcome.ok) {
        const cleanup = outcome.cleanup;
        return {
          ...outcome,
          cleanup: async () => {
            events.push("cleanup");
            await cleanup();
          },
        };
      }
      return outcome;
    };
    const { invokeCodingAgent } = createFakeInvokeCodingAgent({ onCall: () => events.push("coding_agent") });
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ onCall: () => events.push("inspect_working_tree") });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity({ onCall: () => events.push("git_integrity") });

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace: wrappedMaterialize,
      invokeCodingAgent,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(recordSourceRevisionCalls).toEqual([{ executionRunId: "req-1", headSha: "a".repeat(40) }]);
    expect(events).toEqual(["coding_agent", "git_integrity", "inspect_working_tree", "cleanup"]);
  });

  it("does not inspect the working tree when the coding agent invocation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { invokeCodingAgent } = createFakeInvokeCodingAgent({ throwError: new Error("unsafe detail") });
    const { inspectWorkingTree, calls } = createFakeInspectWorkingTree();
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      invokeCodingAgent,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(calls).toEqual([]);
  });

  it("returns ok:true, claimed:true, workingTree:'clean' for a clean working tree", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "clean" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
  });

  it("returns ok:true, claimed:true, workingTree:'changes_detected' when the coding agent changed the working tree", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({
      ok: true,
      claimed: true,
      workingTree: "changes_detected",
      deliveryBranch: "ada/req-1",
      deliveryCommitSha: "c".repeat(40),
      remoteDelivery: { status: "verified", remoteBranch: "ada/req-1", remoteSha: "c".repeat(40) },
    });
  });

  it("cleans up the workspace exactly once, and returns a safe failure outcome, when working-tree inspection reports a structured failure", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ reason: "status_failed", gitErrorCode: 128 });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "working_tree_inspection_error" });
    expect(cleanupCallCount()).toBe(1);
    const errorCall = logCalls.find((call) => call.level === "error" && call.message.includes("working tree"));
    expect(errorCall?.fields).toMatchObject({ gitErrorCode: 128 });
  });

  it("cleans up the workspace exactly once, and returns a safe failure outcome, when working-tree inspection throws unexpectedly", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({
      throwError: new Error("unsafe inspection failure detail"),
    });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "working_tree_inspection_error" });
    expect(cleanupCallCount()).toBe(1);
    expect(serializedLogs(logCalls)).not.toContain("unsafe inspection failure detail");
  });

  it("does not derive or create an ADA delivery branch for a clean working tree", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch, calls } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "clean" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
    expect(calls).toEqual([]);
  });

  it("derives and creates the ADA delivery branch from the still-live workspace path and the trusted executionRequestId, after working-tree inspection, before cleanup", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    let cleanupCallCountAtInvocation = -1;
    const { ensureAdaDeliveryBranch, calls } = createFakeEnsureAdaDeliveryBranch({
      onCall: () => {
        cleanupCallCountAtInvocation = cleanupCallCount();
      },
    });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(calls).toEqual([{ workspacePath: "/tmp/fake-workspace", executionRequestId: "req-1" }]);
    expect(cleanupCallCountAtInvocation).toBe(0);
  });

  it("proves the ordering: sourceRevision persisted -> coding agent invoked -> git integrity verified -> working tree inspected -> changes_detected -> ADA delivery branch created -> cleanup", async () => {
    // Arrange
    const events: string[] = [];
    const { repository, recordSourceRevisionCalls } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const wrappedMaterialize: typeof materializeRepositoryWorkspace = async (request) => {
      const outcome = await materializeRepositoryWorkspace(request);
      if (outcome.ok) {
        const cleanup = outcome.cleanup;
        return {
          ...outcome,
          cleanup: async () => {
            events.push("cleanup");
            await cleanup();
          },
        };
      }
      return outcome;
    };
    const { invokeCodingAgent } = createFakeInvokeCodingAgent({ onCall: () => events.push("coding_agent") });
    const { inspectWorkingTree } = createFakeInspectWorkingTree({
      status: "changes_detected",
      onCall: () => events.push("inspect_working_tree"),
    });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity({ onCall: () => events.push("git_integrity") });
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({
      onCall: () => events.push("ensure_delivery_branch"),
    });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace: wrappedMaterialize,
      invokeCodingAgent,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(recordSourceRevisionCalls).toEqual([{ executionRunId: "req-1", headSha: "a".repeat(40) }]);
    expect(events).toEqual([
      "coding_agent",
      "git_integrity",
      "inspect_working_tree",
      "ensure_delivery_branch",
      "cleanup",
    ]);
  });

  it("exposes the resulting delivery-branch identity on a successful changed-tree outcome", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({ branchName: "ada/req-1" });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({
      ok: true,
      claimed: true,
      workingTree: "changes_detected",
      deliveryBranch: "ada/req-1",
      deliveryCommitSha: "c".repeat(40),
      remoteDelivery: { status: "verified", remoteBranch: "ada/req-1", remoteSha: "c".repeat(40) },
    });
  });

  it("cleans up the workspace exactly once, and returns a safe deterministic failure outcome, when the derived branch name is invalid", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({
      reason: "invalid_branch_name",
      gitErrorCode: 1,
    });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "delivery_branch_invalid_branch_name" });
    expect(cleanupCallCount()).toBe(1);
    const errorCall = logCalls.find(
      (call) => call.level === "error" && call.message === "Failed to create the ADA delivery branch.",
    );
    expect(errorCall?.fields).toMatchObject({ reason: "invalid_branch_name", gitErrorCode: 1 });
  });

  it("cleans up the workspace exactly once, and returns a safe deterministic failure outcome, when branch creation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({
      reason: "branch_creation_failed",
      gitErrorCode: 128,
    });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "delivery_branch_branch_creation_failed" });
    expect(cleanupCallCount()).toBe(1);
    const errorCall = logCalls.find(
      (call) => call.level === "error" && call.message === "Failed to create the ADA delivery branch.",
    );
    expect(errorCall?.fields).toMatchObject({ reason: "branch_creation_failed", gitErrorCode: 128 });
  });

  it("cleans up the workspace exactly once, and returns a safe deterministic failure outcome, when post-creation branch verification fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({
      reason: "branch_verification_failed",
      expectedBranch: "ada/req-1",
      actualBranch: "coding-agent-branch",
    });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "delivery_branch_branch_verification_failed" });
    expect(cleanupCallCount()).toBe(1);
    const errorCall = logCalls.find(
      (call) => call.level === "error" && call.message === "Failed to create the ADA delivery branch.",
    );
    expect(errorCall?.fields).toMatchObject({ expectedBranch: "ada/req-1", actualBranch: "coding-agent-branch" });
  });

  it("cleans up the workspace exactly once, and returns a safe failure outcome, when ADA delivery branch creation throws unexpectedly", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({
      throwError: new Error("unsafe delivery-branch failure detail"),
    });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "delivery_branch_error" });
    expect(cleanupCallCount()).toBe(1);
    expect(serializedLogs(logCalls)).not.toContain("unsafe delivery-branch failure detail");
  });

  it("never logs the prompt or title when ADA delivery branch creation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({ reason: "branch_creation_failed" });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(serializedLogs(logCalls)).not.toContain(PROMPT);
    expect(serializedLogs(logCalls)).not.toContain(TITLE);
  });

  it("creates the ADA delivery commit from the still-live workspace, the verified delivery branch, and the persisted sourceRevision.headSha, after branch verification, before cleanup", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace({
      headSha: "a".repeat(40),
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({ branchName: "ada/req-1" });
    let cleanupCallCountAtInvocation = -1;
    const { ensureAdaDeliveryCommit, calls } = createFakeEnsureAdaDeliveryCommit({
      onCall: () => {
        cleanupCallCountAtInvocation = cleanupCallCount();
      },
    });
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(calls).toEqual([
      {
        workspacePath: "/tmp/fake-workspace",
        executionRequestId: "req-1",
        expectedBranch: "ada/req-1",
        expectedParentSha: "a".repeat(40),
      },
    ]);
    expect(cleanupCallCountAtInvocation).toBe(0);
  });

  it("does not create an ADA delivery commit for a clean working tree", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "clean" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryCommit, calls } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
    expect(calls).toEqual([]);
  });

  it("does not attempt the ADA delivery commit when ADA delivery branch creation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({ reason: "branch_creation_failed" });
    const { ensureAdaDeliveryCommit, calls } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "delivery_branch_branch_creation_failed" });
    expect(calls).toEqual([]);
  });

  it("proves the ordering: ADA delivery branch created -> ADA delivery commit created -> cleanup", async () => {
    // Arrange
    const events: string[] = [];
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const wrappedMaterialize: typeof materializeRepositoryWorkspace = async (request) => {
      const outcome = await materializeRepositoryWorkspace(request);
      if (outcome.ok) {
        const cleanup = outcome.cleanup;
        return {
          ...outcome,
          cleanup: async () => {
            events.push("cleanup");
            await cleanup();
          },
        };
      }
      return outcome;
    };
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({
      onCall: () => events.push("ensure_delivery_branch"),
    });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit({
      onCall: () => events.push("ensure_delivery_commit"),
    });
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush({
      onCall: () => events.push("ensure_delivery_push"),
    });

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace: wrappedMaterialize,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(events).toEqual(["ensure_delivery_branch", "ensure_delivery_commit", "ensure_delivery_push", "cleanup"]);
  });

  it("passes the still-live workspace path, the trusted repository identity, the verified delivery branch, and the verified commit SHA to ensureAdaDeliveryPush", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({ branchName: "ada/req-1" });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit({ commitSha: "c".repeat(40) });
    const { ensureAdaDeliveryPush, calls } = createFakeEnsureAdaDeliveryPush();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(calls).toHaveLength(1);
    expect(calls[0].repository).toBe("johnpwise/kanban-app");
    expect(calls[0].deliveryBranch).toBe("ada/req-1");
    expect(calls[0].deliveryCommitSha).toBe("c".repeat(40));
  });

  it("does not mint a credential or attempt a push for a clean working tree", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit();
    const { ensureAdaDeliveryPush, calls } = createFakeEnsureAdaDeliveryPush();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "clean" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
    expect(calls).toEqual([]);
  });

  it("reports remoteDelivery status:failed without failing the overall outcome when the push cannot be verified", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({ branchName: "ada/req-1" });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit({ commitSha: "c".repeat(40) });
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush({ reason: "remote_sha_mismatch" });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert — the local commit is still valid, so this is not an executor-level failure.
    expect(outcome).toEqual({
      ok: true,
      claimed: true,
      workingTree: "changes_detected",
      deliveryBranch: "ada/req-1",
      deliveryCommitSha: "c".repeat(40),
      remoteDelivery: { status: "failed", reason: "remote_sha_mismatch" },
    });
    expect(cleanupCallCount()).toBe(1);
    expect(serializedLogs(logCalls)).not.toContain(PROMPT);
    expect(serializedLogs(logCalls)).not.toContain(TITLE);
  });

  it("reports remoteDelivery status:failed, cleans up exactly once, and never crashes when ensureAdaDeliveryPush throws unexpectedly", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({ branchName: "ada/req-1" });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit({ commitSha: "c".repeat(40) });
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush({
      throwError: new Error("unsafe push failure detail"),
    });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({
      ok: true,
      claimed: true,
      workingTree: "changes_detected",
      deliveryBranch: "ada/req-1",
      deliveryCommitSha: "c".repeat(40),
      remoteDelivery: { status: "failed", reason: "delivery_push_error" },
    });
    expect(cleanupCallCount()).toBe(1);
    expect(serializedLogs(logCalls)).not.toContain("unsafe push failure detail");
  });

  it("exposes the resulting delivery-commit SHA on a successful changed-tree outcome", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch({ branchName: "ada/req-1" });
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit({ commitSha: "d".repeat(40) });
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({
      ok: true,
      claimed: true,
      workingTree: "changes_detected",
      deliveryBranch: "ada/req-1",
      deliveryCommitSha: "d".repeat(40),
      remoteDelivery: { status: "verified", remoteBranch: "ada/req-1", remoteSha: "d".repeat(40) },
    });
  });

  it("cleans up the workspace exactly once, and returns a safe deterministic failure outcome, when staging the delivery commit fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit({
      reason: "staging_failed",
      gitErrorCode: 128,
    });
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "delivery_commit_staging_failed" });
    expect(cleanupCallCount()).toBe(1);
    const errorCall = logCalls.find(
      (call) => call.level === "error" && call.message === "Failed to create the ADA delivery commit.",
    );
    expect(errorCall?.fields).toMatchObject({ reason: "staging_failed", gitErrorCode: 128 });
  });

  it("cleans up the workspace exactly once, and returns a safe deterministic failure outcome, when the commit itself fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit({
      reason: "commit_failed",
      gitErrorCode: 1,
    });
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "delivery_commit_commit_failed" });
    expect(cleanupCallCount()).toBe(1);
  });

  it("cleans up the workspace exactly once, and returns a safe deterministic failure outcome, when post-commit parent verification fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit({
      reason: "parent_mismatch",
      expectedParentSha: "a".repeat(40),
      actualParentSha: "b".repeat(40),
    });
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "delivery_commit_parent_mismatch" });
    expect(cleanupCallCount()).toBe(1);
    const errorCall = logCalls.find(
      (call) => call.level === "error" && call.message === "Failed to create the ADA delivery commit.",
    );
    expect(errorCall?.fields).toMatchObject({ expectedParentSha: "a".repeat(40), actualParentSha: "b".repeat(40) });
  });

  it("cleans up the workspace exactly once, and returns a safe failure outcome, when ADA delivery commit creation throws unexpectedly", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit({
      throwError: new Error("unsafe delivery-commit failure detail"),
    });
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "delivery_commit_error" });
    expect(cleanupCallCount()).toBe(1);
    expect(serializedLogs(logCalls)).not.toContain("unsafe delivery-commit failure detail");
  });

  it("never logs the prompt or title when ADA delivery commit creation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });
    const { verifyGitIntegrity } = createFakeVerifyGitIntegrity();
    const { ensureAdaDeliveryBranch } = createFakeEnsureAdaDeliveryBranch();
    const { ensureAdaDeliveryCommit } = createFakeEnsureAdaDeliveryCommit({ reason: "commit_failed" });
    const { ensureAdaDeliveryPush } = createFakeEnsureAdaDeliveryPush();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      verifyGitIntegrity,
      ensureAdaDeliveryBranch,
      ensureAdaDeliveryCommit,
      ensureAdaDeliveryPush,
    });

    // Assert
    expect(serializedLogs(logCalls)).not.toContain(PROMPT);
    expect(serializedLogs(logCalls)).not.toContain(TITLE);
  });
});
