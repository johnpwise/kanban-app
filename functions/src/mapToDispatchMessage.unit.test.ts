import { describe, expect, it } from "vitest";

import { mapToDispatchMessage } from "./mapToDispatchMessage";

import type { ExecutionRequestDocumentData } from "./schemas/executionRequestDocument";

const validData: ExecutionRequestDocumentData = {
  projectId: "project-1",
  cardId: "card-1",
  title: "Ship the demo",
  prompt: "Ship the demo build.",
  repository: "johnpwise/kanban-app",
  baseBranch: "develop",
  requestedBy: "user-1",
  requestedAt: "2026-09-20T19:00:00.000Z",
};

describe("mapToDispatchMessage", () => {
  it("should produce the exact versioned message for a valid execution request", () => {
    const message = mapToDispatchMessage("request-1", validData);

    expect(message).toEqual({
      schemaVersion: 1,
      eventType: "ada.execution.requested",
      executionRequestId: "request-1",
      correlationId: "request-1",
      projectId: "project-1",
      cardId: "card-1",
      title: "Ship the demo",
      prompt: "Ship the demo build.",
      repository: "johnpwise/kanban-app",
      baseBranch: "develop",
      requestedBy: "user-1",
      requestedAt: "2026-09-20T19:00:00.000Z",
    });
  });

  it("should use the Firestore document ID as executionRequestId", () => {
    const message = mapToDispatchMessage("doc-abc123", validData);

    expect(message.executionRequestId).toBe("doc-abc123");
  });

  it("should set correlationId equal to executionRequestId", () => {
    const message = mapToDispatchMessage("doc-abc123", validData);

    expect(message.correlationId).toBe("doc-abc123");
  });

  it("should preserve every immutable snapshot field unchanged", () => {
    const message = mapToDispatchMessage("request-1", validData);

    expect(message.projectId).toBe(validData.projectId);
    expect(message.cardId).toBe(validData.cardId);
    expect(message.title).toBe(validData.title);
    expect(message.prompt).toBe(validData.prompt);
    expect(message.repository).toBe(validData.repository);
    expect(message.baseBranch).toBe(validData.baseBranch);
    expect(message.requestedBy).toBe(validData.requestedBy);
    expect(message.requestedAt).toBe(validData.requestedAt);
  });

  it("should reject malformed or incomplete data", () => {
    const incomplete = { ...validData, title: undefined } as unknown;

    expect(() => mapToDispatchMessage("request-1", incomplete)).toThrow();
  });

  it("should reject an invalid repository", () => {
    const invalid = { ...validData, repository: "not-a-repo" };

    expect(() => mapToDispatchMessage("request-1", invalid)).toThrow();
  });

  it("should reject an invalid base branch", () => {
    const invalid = { ...validData, baseBranch: "has spaces" };

    expect(() => mapToDispatchMessage("request-1", invalid)).toThrow();
  });

  it("should reject an invalid requestedAt timestamp", () => {
    const invalid = { ...validData, requestedAt: "not-a-date" };

    expect(() => mapToDispatchMessage("request-1", invalid)).toThrow();
  });

  it("should reject an empty executionRequestId", () => {
    expect(() => mapToDispatchMessage("", validData)).toThrow();
  });

  it("should produce the same logical message on repeated mapping of the same request", () => {
    const first = mapToDispatchMessage("request-1", validData);
    const second = mapToDispatchMessage("request-1", validData);

    expect(second).toEqual(first);
  });
});
