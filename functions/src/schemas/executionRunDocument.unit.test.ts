import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { executionRunDocumentSchema } from "./executionRunDocument";

function validInput() {
  return {
    title: "Ship the demo",
    prompt: "Ship the demo build.",
    repository: "johnpwise/kanban-app",
    baseBranch: "develop",
    requestedBy: "user-1",
    requestedAt: "2026-09-20T00:00:00.000Z",
    schemaVersion: 1,
    eventType: "ada.execution.requested",
  };
}

function validDocument() {
  return {
    executionRequestId: "req-1",
    correlationId: "req-1",
    projectId: "project-1",
    cardId: "card-1",
    status: "accepted",
    acceptedAt: Timestamp.now(),
    firstMessageId: "msg-1",
    input: validInput(),
  };
}

describe("executionRunDocumentSchema", () => {
  it("accepts a valid accepted execution run document", () => {
    expect(() => executionRunDocumentSchema.parse(validDocument())).not.toThrow();
  });

  it("accepts a document without a firstMessageId (not always available)", () => {
    const document = validDocument();
    delete (document as { firstMessageId?: string }).firstMessageId;
    expect(() => executionRunDocumentSchema.parse(document)).not.toThrow();
  });

  it("rejects a status other than accepted", () => {
    const document = { ...validDocument(), status: "planning" };
    expect(() => executionRunDocumentSchema.parse(document)).toThrow();
  });

  it("rejects a non-Timestamp acceptedAt", () => {
    const document = { ...validDocument(), acceptedAt: new Date().toISOString() };
    expect(() => executionRunDocumentSchema.parse(document)).toThrow();
  });

  it("rejects a missing input.title", () => {
    const document = validDocument();
    const input = { ...document.input } as Partial<typeof document.input>;
    delete input.title;
    expect(() => executionRunDocumentSchema.parse({ ...document, input })).toThrow();
  });

  it("rejects an empty executionRequestId", () => {
    const document = { ...validDocument(), executionRequestId: "" };
    expect(() => executionRunDocumentSchema.parse(document)).toThrow();
  });

  it("rejects an unsupported input.schemaVersion", () => {
    const document = validDocument();
    document.input = { ...document.input, schemaVersion: 2 as 1 };
    expect(() => executionRunDocumentSchema.parse(document)).toThrow();
  });

  it("rejects an incorrect input.eventType", () => {
    const document = validDocument();
    document.input = { ...document.input, eventType: "ada.execution.other" as "ada.execution.requested" };
    expect(() => executionRunDocumentSchema.parse(document)).toThrow();
  });
});
