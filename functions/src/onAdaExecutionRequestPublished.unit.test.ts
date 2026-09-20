import { describe, expect, it, vi } from "vitest";

import { handleAdaExecutionRequestPublished } from "./onAdaExecutionRequestPublished";
import { FakeExecutionRunStore } from "./testHelpers/fakeExecutionRunStore";

import type { RunAcceptExecutionRunTransaction } from "./acceptExecutionRun";

const SECRET_PROMPT = "do not leak this prompt text anywhere in error output";

function validBody() {
  return {
    schemaVersion: 1,
    eventType: "ada.execution.requested",
    executionRequestId: "req-1",
    correlationId: "req-1",
    projectId: "project-1",
    cardId: "card-1",
    title: "Ship the demo",
    prompt: SECRET_PROMPT,
    repository: "johnpwise/kanban-app",
    baseBranch: "develop",
    requestedBy: "user-1",
    requestedAt: "2026-09-20T00:00:00.000Z",
  };
}

function validAttributes(body: ReturnType<typeof validBody> = validBody()) {
  return {
    schemaVersion: String(body.schemaVersion),
    eventType: body.eventType,
    executionRequestId: body.executionRequestId,
    correlationId: body.correlationId,
  };
}

function encode(body: unknown): string {
  return Buffer.from(JSON.stringify(body), "utf8").toString("base64");
}

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("handleAdaExecutionRequestPublished", () => {
  it("invokes the acceptance service for a valid message", async () => {
    const store = new FakeExecutionRunStore();
    const logger = fakeLogger();
    const body = validBody();

    await handleAdaExecutionRequestPublished({
      data: encode(body),
      attributes: validAttributes(body),
      transportMessageId: "transport-msg-1",
      createRunTransaction: () => store.runTransaction,
      logger,
    });

    expect(store.get("req-1")?.status).toBe("accepted");
    expect(store.get("req-1")?.firstMessageId).toBe("transport-msg-1");
  });

  it("builds the transaction from the validated body's executionRequestId, not the raw attribute", async () => {
    const store = new FakeExecutionRunStore();
    const logger = fakeLogger();
    const body = validBody();
    const createRunTransaction = vi.fn(() => store.runTransaction);

    await handleAdaExecutionRequestPublished({
      data: encode(body),
      attributes: validAttributes(body),
      createRunTransaction,
      logger,
    });

    expect(createRunTransaction).toHaveBeenCalledWith(body.executionRequestId);
  });

  it("logs and acknowledges a permanently invalid message without creating a run", async () => {
    const store = new FakeExecutionRunStore();
    const logger = fakeLogger();
    const body = validBody() as Partial<ReturnType<typeof validBody>>;
    delete body.title;

    await expect(
      handleAdaExecutionRequestPublished({
        data: encode(body),
        attributes: validAttributes(body as ReturnType<typeof validBody>),
        createRunTransaction: () => store.runTransaction,
        logger,
      }),
    ).resolves.toBeUndefined();

    expect(store.size()).toBe(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it("never invokes createRunTransaction for a permanently invalid message", async () => {
    const store = new FakeExecutionRunStore();
    const logger = fakeLogger();
    const body = validBody();
    const createRunTransaction = vi.fn(() => store.runTransaction);

    await handleAdaExecutionRequestPublished({
      data: encode(body),
      attributes: { ...validAttributes(body), executionRequestId: "different-id" },
      createRunTransaction,
      logger,
    });

    expect(createRunTransaction).not.toHaveBeenCalled();
  });

  it("never logs the complete message body or prompt for an invalid message", async () => {
    const store = new FakeExecutionRunStore();
    const logger = fakeLogger();
    const body = validBody();

    await handleAdaExecutionRequestPublished({
      data: encode(body),
      attributes: { ...validAttributes(body), correlationId: "different-id" },
      createRunTransaction: () => store.runTransaction,
      logger,
    });

    for (const call of logger.error.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET_PROMPT);
    }
  });

  it("rethrows a transient persistence error so the platform retries", async () => {
    const failingRunTransaction: RunAcceptExecutionRunTransaction = async () => {
      throw new Error("Firestore unavailable");
    };
    const body = validBody();

    await expect(
      handleAdaExecutionRequestPublished({
        data: encode(body),
        attributes: validAttributes(body),
        createRunTransaction: () => failingRunTransaction,
        logger: fakeLogger(),
      }),
    ).rejects.toThrow("Firestore unavailable");
  });

  it("logs safe correlation identifiers on success", async () => {
    const store = new FakeExecutionRunStore();
    const logger = fakeLogger();
    const body = validBody();

    await handleAdaExecutionRequestPublished({
      data: encode(body),
      attributes: validAttributes(body),
      createRunTransaction: () => store.runTransaction,
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ executionRequestId: "req-1", correlationId: "req-1" }),
    );
  });
});
