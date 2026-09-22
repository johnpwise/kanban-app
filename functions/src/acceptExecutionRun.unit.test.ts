import { describe, expect, it, vi } from "vitest";

import { acceptExecutionRun } from "./acceptExecutionRun";
import { FakeExecutionRunStore } from "./testHelpers/fakeExecutionRunStore";

import type { AcceptExecutionRunTransaction, RunAcceptExecutionRunTransaction } from "./acceptExecutionRun";
import type { DispatchMessage } from "./schemas/dispatchMessage";

function validMessage(overrides: Partial<DispatchMessage> = {}): DispatchMessage {
  return {
    schemaVersion: 1,
    eventType: "ada.execution.requested",
    executionRequestId: "req-1",
    correlationId: "req-1",
    projectId: "project-1",
    cardId: "card-1",
    title: "Ship the demo",
    prompt: "Ship the demo build.",
    repository: "johnpwise/kanban-app",
    baseBranch: "develop",
    requestedBy: "user-1",
    requestedAt: "2026-09-20T00:00:00.000Z",
    ...overrides,
  };
}

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("acceptExecutionRun", () => {
  it("creates the expected accepted Execution Run", async () => {
    const store = new FakeExecutionRunStore();
    const logger = fakeLogger();
    const message = validMessage();

    await acceptExecutionRun({ message, firstMessageId: "msg-1", runTransaction: store.runTransaction, logger });

    const document = store.get("req-1");
    expect(document?.status).toBe("accepted");
    expect(document?.executionRequestId).toBe("req-1");
    expect(document?.correlationId).toBe("req-1");
    expect(document?.projectId).toBe("project-1");
    expect(document?.cardId).toBe("card-1");
  });

  it("uses executionRequestId as the document id", async () => {
    const store = new FakeExecutionRunStore();
    await acceptExecutionRun({
      message: validMessage({ executionRequestId: "req-1" }),
      runTransaction: store.runTransaction,
      logger: fakeLogger(),
    });
    expect(store.get("req-1")).toBeDefined();
  });

  it("stores the validated immutable input", async () => {
    const store = new FakeExecutionRunStore();
    const message = validMessage();
    await acceptExecutionRun({ message, runTransaction: store.runTransaction, logger: fakeLogger() });

    expect(store.get("req-1")?.input).toEqual({
      title: message.title,
      prompt: message.prompt,
      repository: message.repository,
      baseBranch: message.baseBranch,
      requestedBy: message.requestedBy,
      requestedAt: message.requestedAt,
      schemaVersion: message.schemaVersion,
      eventType: message.eventType,
    });
  });

  it("generates acceptedAt server-side as a Firestore Timestamp", async () => {
    const store = new FakeExecutionRunStore();
    await acceptExecutionRun({ message: validMessage(), runTransaction: store.runTransaction, logger: fakeLogger() });

    const acceptedAt = store.get("req-1")?.acceptedAt;
    expect(typeof acceptedAt?.toDate).toBe("function");
  });

  it("stores the first Pub/Sub message id where available", async () => {
    const store = new FakeExecutionRunStore();
    await acceptExecutionRun({
      message: validMessage(),
      firstMessageId: "transport-msg-1",
      runTransaction: store.runTransaction,
      logger: fakeLogger(),
    });
    expect(store.get("req-1")?.firstMessageId).toBe("transport-msg-1");
  });

  it("omits firstMessageId when not available", async () => {
    const store = new FakeExecutionRunStore();
    await acceptExecutionRun({ message: validMessage(), runTransaction: store.runTransaction, logger: fakeLogger() });
    expect(store.get("req-1")?.firstMessageId).toBeUndefined();
  });

  it("returns successfully without creating another document on duplicate delivery", async () => {
    const store = new FakeExecutionRunStore();
    const logger = fakeLogger();
    const message = validMessage();

    await acceptExecutionRun({ message, runTransaction: store.runTransaction, logger });
    await acceptExecutionRun({ message, runTransaction: store.runTransaction, logger });

    expect(store.size()).toBe(1);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("Duplicate"), expect.any(Object));
  });

  it("creates only one document from concurrent duplicate deliveries", async () => {
    const store = new FakeExecutionRunStore();
    const logger = fakeLogger();
    const message = validMessage();

    await Promise.all([
      acceptExecutionRun({ message, runTransaction: store.runTransaction, logger }),
      acceptExecutionRun({ message, runTransaction: store.runTransaction, logger }),
    ]);

    expect(store.size()).toBe(1);
  });

  it("does not overwrite an existing run with conflicting immutable data", async () => {
    const store = new FakeExecutionRunStore();
    const logger = fakeLogger();

    await acceptExecutionRun({ message: validMessage(), runTransaction: store.runTransaction, logger });
    const before = store.get("req-1");

    await acceptExecutionRun({
      message: validMessage({ title: "A different title entirely" }),
      runTransaction: store.runTransaction,
      logger,
    });

    expect(store.get("req-1")).toEqual(before);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Conflicting"), expect.any(Object));
  });

  it("rethrows a transient Firestore/transaction failure", async () => {
    const failingRunTransaction: RunAcceptExecutionRunTransaction = async () => {
      throw new Error("Firestore unavailable");
    };

    await expect(
      acceptExecutionRun({ message: validMessage(), runTransaction: failingRunTransaction, logger: fakeLogger() }),
    ).rejects.toThrow("Firestore unavailable");
  });

  it("leaves no partial document after a transaction failure", async () => {
    const store = new FakeExecutionRunStore();
    const failingRunTransaction: RunAcceptExecutionRunTransaction = async (work) => {
      const tx: AcceptExecutionRunTransaction = {
        getExistingRun: async () => undefined,
        createRun: () => {
          throw new Error("commit failed after staging a write");
        },
      };
      return work(tx);
    };

    await expect(
      acceptExecutionRun({ message: validMessage(), runTransaction: failingRunTransaction, logger: fakeLogger() }),
    ).rejects.toThrow();

    expect(store.size()).toBe(0);
  });
});
