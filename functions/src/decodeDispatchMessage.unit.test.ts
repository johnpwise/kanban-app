import { describe, expect, it } from "vitest";

import { DispatchMessageValidationError, decodeDispatchMessage } from "./decodeDispatchMessage";

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

describe("decodeDispatchMessage", () => {
  it("decodes and validates a valid message", () => {
    const body = validBody();
    const message = decodeDispatchMessage(encode(body), validAttributes(body));
    expect(message).toEqual(body);
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeDispatchMessage(Buffer.from("not json", "utf8").toString("base64"), validAttributes())).toThrow(
      DispatchMessageValidationError,
    );
  });

  it("rejects an unsupported schemaVersion", () => {
    const body = { ...validBody(), schemaVersion: 2 };
    expect(() => decodeDispatchMessage(encode(body), validAttributes(body as unknown as ReturnType<typeof validBody>))).toThrow(
      DispatchMessageValidationError,
    );
  });

  it("rejects an incorrect eventType", () => {
    const body = { ...validBody(), eventType: "ada.execution.other" };
    expect(() => decodeDispatchMessage(encode(body), validAttributes(body as unknown as ReturnType<typeof validBody>))).toThrow(
      DispatchMessageValidationError,
    );
  });

  it("rejects a missing required field", () => {
    const body = validBody() as Partial<ReturnType<typeof validBody>>;
    delete body.title;
    expect(() => decodeDispatchMessage(encode(body), validAttributes())).toThrow(DispatchMessageValidationError);
  });

  it("rejects an invalid repository format", () => {
    const body = { ...validBody(), repository: "not-a-repo" };
    expect(() => decodeDispatchMessage(encode(body), validAttributes(body))).toThrow(DispatchMessageValidationError);
  });

  it("rejects a branch name containing whitespace", () => {
    const body = { ...validBody(), baseBranch: "feature branch" };
    expect(() => decodeDispatchMessage(encode(body), validAttributes(body))).toThrow(DispatchMessageValidationError);
  });

  it("rejects an invalid requestedAt timestamp", () => {
    const body = { ...validBody(), requestedAt: "not-a-date" };
    expect(() => decodeDispatchMessage(encode(body), validAttributes(body))).toThrow(DispatchMessageValidationError);
  });

  it("rejects an empty executionRequestId", () => {
    const body = { ...validBody(), executionRequestId: "" };
    expect(() => decodeDispatchMessage(encode(body), validAttributes(body))).toThrow(DispatchMessageValidationError);
  });

  it("rejects when attributes disagree with the body", () => {
    const body = validBody();
    const attributes = { ...validAttributes(body), executionRequestId: "different-id" };
    expect(() => decodeDispatchMessage(encode(body), attributes)).toThrow(DispatchMessageValidationError);
  });

  it("rejects when an attribute is missing entirely", () => {
    const body = validBody();
    const attributes = validAttributes(body) as Partial<ReturnType<typeof validAttributes>>;
    delete attributes.correlationId;
    expect(() => decodeDispatchMessage(encode(body), attributes as Record<string, string>)).toThrow(
      DispatchMessageValidationError,
    );
  });

  it("never includes the full prompt in a validation error", () => {
    const body = validBody() as Partial<ReturnType<typeof validBody>>;
    delete body.title;
    try {
      decodeDispatchMessage(encode(body), validAttributes());
      throw new Error("expected decodeDispatchMessage to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DispatchMessageValidationError);
      expect(String((error as Error).message)).not.toContain(SECRET_PROMPT);
    }
  });
});
