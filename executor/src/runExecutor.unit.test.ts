import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { runExecutor } from "./runExecutor";
import { createFakeExecutionRunRepository } from "./testHelpers/fakeExecutionRunRepository";
import { createFakeLogger } from "./testHelpers/fakeLogger";

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
  it("returns success for a valid configuration and an accepted run", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();

    // Act
    const outcome = await runExecutor({
      env: { ADA_EXECUTION_RUN_ID: "req-1" },
      repository,
      logger,
    });

    // Assert
    expect(outcome).toEqual({ ok: true });
  });

  it("loads the run using the exact execution run id from the environment", async () => {
    // Arrange
    const { repository, calls } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger });

    // Assert
    expect(calls).toEqual([{ executionRunId: "req-1" }]);
  });

  it("returns failure for missing/invalid environment configuration", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger } = createFakeLogger();

    // Act
    const outcome = await runExecutor({ env: {}, repository, logger });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure when the execution run is not found", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: undefined });
    const { logger } = createFakeLogger();

    // Act
    const outcome = await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure for a malformed execution run document", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: { not: "valid" } });
    const { logger } = createFakeLogger();

    // Act
    const outcome = await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure when the execution run is not in accepted status", async () => {
    // Arrange
    const data = { ...validRunData(), status: "planning" };
    const { repository } = createFakeExecutionRunRepository({ data });
    const { logger } = createFakeLogger();

    // Act
    const outcome = await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("returns failure when the repository throws a transient error", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ throwError: new Error("unavailable") });
    const { logger } = createFakeLogger();

    // Act
    const outcome = await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger });

    // Assert
    expect(outcome.ok).toBe(false);
  });

  it("logs safe identifiers on success", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger });

    // Assert
    const successCall = calls.find((call) => call.level === "info");
    expect(successCall?.fields).toMatchObject({
      executionRequestId: "req-1",
      correlationId: "corr-1",
      projectId: "project-1",
      cardId: "card-1",
    });
  });

  it("never logs the prompt or full execution input", async () => {
    // Arrange
    const { repository } = createFakeExecutionRunRepository({ data: validRunData() });
    const { logger, calls } = createFakeLogger();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
  });

  it("never logs the prompt or full input even on a malformed-run failure", async () => {
    // Arrange
    const data = { ...validRunData(), input: { ...validRunData().input, extra: PROMPT } };
    const { repository } = createFakeExecutionRunRepository({ data: { ...data, status: "unknown" } });
    const { logger, calls } = createFakeLogger();

    // Act
    await runExecutor({ env: { ADA_EXECUTION_RUN_ID: "req-1" }, repository, logger });

    // Assert
    expect(serializedLogs(calls)).not.toContain(PROMPT);
  });
});
