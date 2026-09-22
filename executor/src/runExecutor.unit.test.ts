import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { ProcessCodingAgentRuntimeError } from "./processCodingAgentRuntime";
import { runExecutor } from "./runExecutor";
import { createFakeExecutionRunRepository } from "./testHelpers/fakeExecutionRunRepository";
import { createFakeInspectWorkingTree } from "./testHelpers/fakeInspectWorkingTree";
import { createFakeLogger } from "./testHelpers/fakeLogger";
import { createFakeMaterializeRepositoryWorkspace } from "./testHelpers/fakeMaterializeRepositoryWorkspace";
import { createFakeInvokeCodingAgent } from "./testHelpers/fakeInvokeCodingAgent";

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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
  });

  it("passes the execution run id and a generated claim id to the repository's claim call", async () => {
    // Arrange
    const { repository, claimCalls } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
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
    const { materializeRepositoryWorkspace, calls } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

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
    const { materializeRepositoryWorkspace, calls } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
    });

    // Assert
    expect(outcome.ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("loads the run using the exact execution run id from the environment", async () => {
    // Arrange
    const { repository, calls } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

    // Assert
    expect(calls).toEqual([{ executionRunId: "req-1" }]);
  });

  it("returns failure for missing/invalid environment configuration", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({ env: {}, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure when the execution run is not found", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: undefined });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure for a malformed execution run document", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: { not: "valid" } });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure when the execution run is not in accepted status", async () => {
    // Arrange
    const data = { ...validRunData(), status: "planning" };
    const { repository } = createFakeExecutionRunRepository({ data });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure when the repository throws a transient error", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ throwError: new Error("unavailable") });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("logs safe identifiers and the checked-out HEAD SHA on success", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
    expect(serializedLogs(calls)).not.toContain(TITLE);
  });

  it("never logs the prompt, title, or full input even on a malformed-run failure", async () => {
    // Arrange
    const data = { ...validRunData(), input: { ...validRunData().input, extra: PROMPT } };
    const { repository } = createFakeExecutionRunRepository({ data: { ...data, status: "unknown" } });
    const { logger, calls } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
    expect(serializedLogs(calls)).not.toContain(TITLE);
  });

  it("materialises the repository workspace exactly once, using only the immutable input's repository and baseBranch, after winning the claim", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace, calls } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

    // Assert
    expect(calls).toEqual([{ repository: "johnpwise/kanban-app", baseBranch: "develop" }]);
  });

  it("cleans up the materialised workspace exactly once after a successful checkout", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

    // Assert
    expect(cleanupCallCount()).toBe(1);
  });

  it("returns failure with a matching reason when repository materialisation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({ reason: "clone_failed" });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "clone_failed" });
  });

  it("returns failure when repository materialisation throws unexpectedly", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      throwError: new Error("unexpected"),
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("never logs the prompt or title when repository materialisation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({ reason: "checkout_failed" });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
    expect(serializedLogs(calls)).not.toContain(TITLE);
  });

  it("logs the safe git exit code alongside the reason when repository materialisation fails with a git failure", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      reason: "clone_failed",
      gitErrorCode: 128,
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({ reason: "clone_failed" });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

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
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

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
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

    // Assert
    expect(cleanupCallCount()).toBe(1);
  });

  it("invokes the coding agent with the execution request id, task, and live workspace, before cleanup runs", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace({
      headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
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
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { invokeCodingAgent } = createFakeInvokeCodingAgent();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
      invokeCodingAgent,
    });

    // Assert
    expect(cleanupCallCount()).toBe(1);
  });

  it("cleans up the workspace exactly once, and returns a safe failure outcome, when the coding agent invocation throws", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
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
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({ reason: "clone_failed" });
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { invokeCodingAgent, calls } = createFakeInvokeCodingAgent();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();
    const { invokeCodingAgent, calls } = createFakeInvokeCodingAgent();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
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
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace, inspectWorkingTree });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
    expect(serializedLogs(calls)).not.toContain(TITLE);
  });

  it("inspects the working tree at the still-live workspace path after the coding agent invocation succeeds, before cleanup", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { invokeCodingAgent } = createFakeInvokeCodingAgent();
    let cleanupCallCountAtInspection = -1;
    const { inspectWorkingTree, calls } = createFakeInspectWorkingTree({
      onCall: () => {
        cleanupCallCountAtInspection = cleanupCallCount();
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
    });

    // Assert
    expect(calls).toEqual([{ workspacePath: "/tmp/fake-workspace" }]);
    expect(cleanupCallCountAtInspection).toBe(0);
  });

  it("proves the ordering: sourceRevision persisted -> coding agent invoked -> working tree inspected -> workspace cleanup", async () => {
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
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ onCall: () => events.push("inspect_working_tree") });

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace: wrappedMaterialize,
      invokeCodingAgent,
      inspectWorkingTree,
    });

    // Assert
    expect(recordSourceRevisionCalls).toEqual([{ executionRunId: "req-1", headSha: "a".repeat(40) }]);
    expect(events).toEqual(["coding_agent", "inspect_working_tree", "cleanup"]);
  });

  it("does not inspect the working tree when the coding agent invocation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { invokeCodingAgent } = createFakeInvokeCodingAgent({ throwError: new Error("unsafe detail") });
    const { inspectWorkingTree, calls } = createFakeInspectWorkingTree();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      invokeCodingAgent,
      inspectWorkingTree,
    });

    // Assert
    expect(calls).toEqual([]);
  });

  it("returns ok:true, claimed:true, workingTree:'clean' for a clean working tree", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "clean" });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "clean" });
  });

  it("returns ok:true, claimed:true, workingTree:'changes_detected' when the coding agent changed the working tree", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ status: "changes_detected" });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true, workingTree: "changes_detected" });
  });

  it("cleans up the workspace exactly once, and returns a safe failure outcome, when working-tree inspection reports a structured failure", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls: logCalls } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({ reason: "status_failed", gitErrorCode: 128 });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
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
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();
    const { inspectWorkingTree } = createFakeInspectWorkingTree({
      throwError: new Error("unsafe inspection failure detail"),
    });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
      inspectWorkingTree,
    });

    // Assert
    expect(outcome).toEqual({ ok: false, reason: "working_tree_inspection_error" });
    expect(cleanupCallCount()).toBe(1);
    expect(serializedLogs(logCalls)).not.toContain("unsafe inspection failure detail");
  });
});
