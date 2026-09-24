import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { AdaCodexModelConfigError } from "./adaCodexModelPolicy";
import { launchExecutionRun } from "./launchExecutionRun";

import type { LaunchAdaExecutorJob, LaunchAdaExecutorJobResult } from "./launchExecutionRun";

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function validRunDocument(overrides: Record<string, unknown> = {}) {
  return {
    executionRequestId: "req-1",
    correlationId: "req-1",
    projectId: "project-1",
    cardId: "card-1",
    status: "accepted",
    acceptedAt: Timestamp.now(),
    input: {
      title: "Ship the demo",
      prompt: "Ship the demo build.",
      repository: "johnpwise/kanban-app",
      baseBranch: "develop",
      requestedBy: "user-1",
      requestedAt: "2026-09-20T00:00:00.000Z",
      schemaVersion: 1,
      eventType: "ada.execution.requested",
    },
    ...overrides,
  };
}

function fakeLaunchJob(result: LaunchAdaExecutorJobResult = { operationName: "op-1" }): LaunchAdaExecutorJob {
  return vi.fn().mockResolvedValue(result);
}

describe("launchExecutionRun", () => {
  it("requests exactly one launch with the validated executionRequestId for a valid accepted run", async () => {
    const launchJob = fakeLaunchJob();

    await launchExecutionRun({
      documentId: "req-1",
      data: validRunDocument(),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ executionRequestId: "req-1" });
  });

  it("acknowledges without launching when the event carried no document data", async () => {
    const launchJob = fakeLaunchJob();
    const logger = fakeLogger();

    await launchExecutionRun({ documentId: "req-1", data: undefined, eventId: "event-1", launchJob, logger });

    expect(launchJob).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("acknowledges without launching a malformed execution run document", async () => {
    const launchJob = fakeLaunchJob();
    const logger = fakeLogger();

    await launchExecutionRun({
      documentId: "req-1",
      data: { executionRequestId: "req-1" },
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("acknowledges without launching a status other than accepted", async () => {
    const launchJob = fakeLaunchJob();
    const logger = fakeLogger();

    await launchExecutionRun({
      documentId: "req-1",
      data: validRunDocument({ status: "in_progress" }),
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("acknowledges without launching when the document id does not match its executionRequestId field", async () => {
    const launchJob = fakeLaunchJob();
    const logger = fakeLogger();

    await launchExecutionRun({
      documentId: "req-2",
      data: validRunDocument({ executionRequestId: "req-1" }),
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("never logs the prompt or the full execution run input", async () => {
    const launchJob = fakeLaunchJob();
    const logger = fakeLogger();

    await launchExecutionRun({
      documentId: "req-1",
      data: validRunDocument(),
      eventId: "event-1",
      launchJob,
      logger,
    });

    const allLoggedMeta = [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls].map(
      (call) => JSON.stringify(call),
    );
    for (const entry of allLoggedMeta) {
      expect(entry).not.toContain("Ship the demo build.");
      expect(entry).not.toContain("\"input\"");
      expect(entry).not.toContain("\"prompt\"");
    }
  });

  it("logs only safe identifiers and the operation identity on a successful launch", async () => {
    const launchJob = fakeLaunchJob({ operationName: "projects/p/locations/l/operations/op-9" });
    const logger = fakeLogger();

    await launchExecutionRun({
      documentId: "req-1",
      data: validRunDocument(),
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        executionRequestId: "req-1",
        correlationId: "req-1",
        eventId: "event-1",
        operationName: "projects/p/locations/l/operations/op-9",
      }),
    );
  });

  it("rethrows a transient launcher failure so the platform retries", async () => {
    const launchJob: LaunchAdaExecutorJob = vi.fn().mockRejectedValue(new Error("network blip"));

    await expect(
      launchExecutionRun({
        documentId: "req-1",
        data: validRunDocument(),
        eventId: "event-1",
        launchJob,
        logger: fakeLogger(),
      }),
    ).rejects.toThrow("network blip");
  });

  it.each([
    ["permission", 7],
    ["missing-resource", 5],
    ["invalid-configuration (invalid argument)", 3],
    ["invalid-configuration (failed precondition)", 9],
  ])("classifies a %s launcher error and acknowledges without retry", async (_label, code) => {
    const launchJob: LaunchAdaExecutorJob = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { code }));
    const logger = fakeLogger();

    await launchExecutionRun({
      documentId: "req-1",
      data: validRunDocument(),
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(logger.error).toHaveBeenCalled();
  });

  it("classifies a fail-closed Codex model configuration error as invalid-configuration and acknowledges without retry", async () => {
    const launchJob: LaunchAdaExecutorJob = vi
      .fn()
      .mockRejectedValue(new AdaCodexModelConfigError("CODEX_MODEL must be one of: gpt-5.6-luna, gpt-5.6-terra."));
    const logger = fakeLogger();

    await launchExecutionRun({
      documentId: "req-1",
      data: validRunDocument(),
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ classification: "invalid-configuration" }),
    );
  });

  it("never logs a Codex model configuration error's message (may echo the rejected value, kept out of structured log fields)", async () => {
    const launchJob: LaunchAdaExecutorJob = vi
      .fn()
      .mockRejectedValue(new AdaCodexModelConfigError("CODEX_MODEL must be one of: gpt-5.6-luna, gpt-5.6-terra."));
    const logger = fakeLogger();

    await launchExecutionRun({
      documentId: "req-1",
      data: validRunDocument(),
      eventId: "event-1",
      launchJob,
      logger,
    });

    const allLoggedMeta = [...logger.info.mock.calls, ...logger.warn.mock.calls, ...logger.error.mock.calls].map(
      (call) => JSON.stringify(call),
    );
    for (const entry of allLoggedMeta) {
      expect(entry).not.toContain("must be one of");
    }
  });
});
