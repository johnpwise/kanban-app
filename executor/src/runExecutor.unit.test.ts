import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { runExecutor } from "./runExecutor";
import { createFakeExecutionRunRepository } from "./testHelpers/fakeExecutionRunRepository";
import { createFakeLogger } from "./testHelpers/fakeLogger";
import { createFakeMaterializeRepositoryWorkspace } from "./testHelpers/fakeMaterializeRepositoryWorkspace";

const PROMPT = "Do not leak this prompt text into any log line.";

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
      title: "Ship the demo",
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

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
    });

    // Assert
    expect(outcome).toEqual({ ok: true, claimed: true });
  });

  it("passes the execution run id and a generated claim id to the repository's claim call", async () => {
    // Arrange
    const { repository, claimCalls } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
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

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
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

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace });

    // Assert
    const infoCall = calls.find((call) => call.level === "info");
    expect(infoCall?.fields).toMatchObject({
      executionRequestId: "req-1",
      correlationId: "corr-1",
      projectId: "project-1",
      cardId: "card-1",
    });
    expect(serializedLogs(calls)).not.toContain(PROMPT);
  });

  it("does not attempt to claim a run that fails validation", async () => {
    // Arrange
    const { repository, claimCalls } = createFakeExecutionRunRepository({ data: undefined });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace });

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

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
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

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace });

    // Assert
    expect(calls).toEqual([{ executionRunId: "req-1" }]);
  });

  it("returns failure for missing/invalid environment configuration", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();

    // Act
    const outcome = await runExecutor({ env: {}, repository, logger, materializeRepositoryWorkspace });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure when the execution run is not found", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: undefined });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure for a malformed execution run document", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: { not: "valid" } });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
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

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure when the repository throws a transient error", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ throwError: new Error("unavailable") });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
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

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace });

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

  it("never logs the prompt or full execution input", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
  });

  it("never logs the prompt or full input even on a malformed-run failure", async () => {
    // Arrange
    const data = { ...validRunData(), input: { ...validRunData().input, extra: PROMPT } };
    const { repository } = createFakeExecutionRunRepository({ data: { ...data, status: "unknown" } });
    const { logger, calls } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
  });

  it("materialises the repository workspace exactly once, using only the immutable input's repository and baseBranch, after winning the claim", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace, calls } = createFakeMaterializeRepositoryWorkspace();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace });

    // Assert
    expect(calls).toEqual([
      { repository: "johnpwise/kanban-app", baseBranch: "develop", captureUnsafeDebugStderr: false },
    ]);
  });

  it("cleans up the materialised workspace exactly once after a successful checkout", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace, cleanupCallCount } = createFakeMaterializeRepositoryWorkspace();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace });

    // Assert
    expect(cleanupCallCount()).toBe(1);
  });

  it("returns failure with a matching reason when repository materialisation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({ reason: "clone_failed" });

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
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

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
    });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("never logs the prompt when repository materialisation fails", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({ reason: "checkout_failed" });

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
  });

  it("logs the safe git exit code alongside the reason when repository materialisation fails with a git failure", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      reason: "clone_failed",
      gitErrorCode: 128,
    });

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace });

    // Assert
    const errorCall = calls.find(
      (call) => call.level === "error" && call.message === "Failed to materialise the repository workspace.",
    );
    expect(errorCall?.fields).toMatchObject({ reason: "clone_failed", gitErrorCode: 128 });
  });

  it("opts into raw stderr capture only when ADA_DEBUG_UNSAFE_GIT_STDERR=1 is explicitly set (temporary diagnostic)", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace, calls } = createFakeMaterializeRepositoryWorkspace();

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1", ADA_DEBUG_UNSAFE_GIT_STDERR: "1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
    });

    // Assert
    expect(calls[0]).toMatchObject({ captureUnsafeDebugStderr: true });
  });

  it("does not opt into raw stderr capture when ADA_DEBUG_UNSAFE_GIT_STDERR is unset", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();
    const { materializeRepositoryWorkspace, calls } = createFakeMaterializeRepositoryWorkspace();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger, materializeRepositoryWorkspace });

    // Assert
    expect(calls[0]).toMatchObject({ captureUnsafeDebugStderr: false });
  });

  it("logs the raw git stderr only when ADA_DEBUG_UNSAFE_GIT_STDERR=1 is explicitly set and materialisation fails with a git failure (temporary diagnostic)", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();
    const { materializeRepositoryWorkspace } = createFakeMaterializeRepositoryWorkspace({
      reason: "clone_failed",
      gitErrorCode: 128,
      unsafeDebugStderr: "fatal: could not read from remote repository.",
    });

    // Act
    await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1", ADA_DEBUG_UNSAFE_GIT_STDERR: "1" },
      repository,
      logger,
      materializeRepositoryWorkspace,
    });

    // Assert
    const errorCall = calls.find(
      (call) => call.level === "error" && call.message === "Failed to materialise the repository workspace.",
    );
    expect(errorCall?.fields).toMatchObject({ unsafeDebugStderr: "fatal: could not read from remote repository." });
  });
});
