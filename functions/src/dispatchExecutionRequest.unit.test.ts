import { describe, expect, it, vi } from "vitest";

import { dispatchExecutionRequest } from "./dispatchExecutionRequest";

const validData = {
  projectId: "project-1",
  cardId: "card-1",
  title: "Ship the demo",
  prompt: "Ship the demo build.",
  repository: "johnpwise/kanban-app",
  baseBranch: "develop",
  requestedBy: "user-1",
  requestedAt: "2026-09-20T19:00:00.000Z",
};

function createLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("dispatchExecutionRequest", () => {
  it("should publish once with the exact JSON data and attributes for a valid request", async () => {
    const publish = vi.fn().mockResolvedValue("message-id-1");
    const logger = createLogger();

    await dispatchExecutionRequest({ executionRequestId: "request-1", data: validData, publish, logger });

    expect(publish).toHaveBeenCalledTimes(1);
    const [data, attributes] = publish.mock.calls[0];
    expect(JSON.parse((data as Buffer).toString("utf8"))).toEqual({
      schemaVersion: 1,
      eventType: "ada.execution.requested",
      executionRequestId: "request-1",
      correlationId: "request-1",
      ...validData,
    });
    expect(attributes).toEqual({
      schemaVersion: "1",
      eventType: "ada.execution.requested",
      executionRequestId: "request-1",
      correlationId: "request-1",
    });
  });

  it("should log a structured success with safe identifiers only, no message body", async () => {
    const publish = vi.fn().mockResolvedValue("message-id-1");
    const logger = createLogger();

    await dispatchExecutionRequest({ executionRequestId: "request-1", data: validData, publish, logger });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const [, meta] = logger.info.mock.calls[0];
    expect(meta).toEqual({ executionRequestId: "request-1", correlationId: "request-1", messageId: "message-id-1" });
    expect(JSON.stringify(meta)).not.toContain(validData.prompt);
  });

  it("should log and not publish when the data fails validation, without throwing", async () => {
    const publish = vi.fn();
    const logger = createLogger();

    await dispatchExecutionRequest({
      executionRequestId: "request-1",
      data: { ...validData, repository: "not-a-repo" },
      publish,
      logger,
    });

    expect(publish).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1]).toMatchObject({ executionRequestId: "request-1" });
  });

  it("should log and not publish for an empty executionRequestId", async () => {
    const publish = vi.fn();
    const logger = createLogger();

    await dispatchExecutionRequest({ executionRequestId: "", data: validData, publish, logger });

    expect(publish).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it("should log and rethrow a transient publish failure so the platform retries", async () => {
    const publish = vi.fn().mockRejectedValue(new Error("pubsub unavailable"));
    const logger = createLogger();

    await expect(
      dispatchExecutionRequest({ executionRequestId: "request-1", data: validData, publish, logger }),
    ).rejects.toThrow("pubsub unavailable");

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][1]).toMatchObject({ executionRequestId: "request-1" });
    expect(logger.info).not.toHaveBeenCalled();
  });
});
