import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { parseExecutionRunDocument } from "./executionRunDocument";

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

function validData() {
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

describe("parseExecutionRunDocument", () => {
  it("accepts a valid accepted execution run whose document ID matches executionRequestId", () => {
    // Arrange
    const data = validData();

    // Act
    const result = parseExecutionRunDocument("req-1", data);

    // Assert
    expect(result.executionRequestId).toBe("req-1");
    expect(result.status).toBe("accepted");
  });

  it("accepts a document without a firstMessageId (not always available)", () => {
    // Arrange
    const data = validData();
    delete (data as { firstMessageId?: string }).firstMessageId;

    // Act
    const act = () => parseExecutionRunDocument("req-1", data);

    // Assert
    expect(act).not.toThrow();
  });

  it("rejects a document ID / executionRequestId body mismatch", () => {
    // Arrange
    const data = validData();

    // Act
    const act = () => parseExecutionRunDocument("some-other-id", data);

    // Assert
    expect(act).toThrow();
  });

  it("rejects a status other than accepted", () => {
    // Arrange
    const data = { ...validData(), status: "planning" };

    // Act
    const act = () => parseExecutionRunDocument("req-1", data);

    // Assert
    expect(act).toThrow();
  });

  it("rejects a non-Timestamp acceptedAt", () => {
    // Arrange
    const data = { ...validData(), acceptedAt: new Date().toISOString() };

    // Act
    const act = () => parseExecutionRunDocument("req-1", data);

    // Assert
    expect(act).toThrow();
  });

  it("rejects a missing input.title", () => {
    // Arrange
    const data = validData();
    const input = { ...data.input } as Partial<typeof data.input>;
    delete input.title;

    // Act
    const act = () => parseExecutionRunDocument("req-1", { ...data, input });

    // Assert
    expect(act).toThrow();
  });

  it("rejects an empty executionRequestId", () => {
    // Arrange
    const data = { ...validData(), executionRequestId: "" };

    // Act
    const act = () => parseExecutionRunDocument("", data);

    // Assert
    expect(act).toThrow();
  });

  it("rejects an invalid repository value", () => {
    // Arrange
    const data = validData();
    data.input = { ...data.input, repository: "not-a-repo" };

    // Act
    const act = () => parseExecutionRunDocument("req-1", data);

    // Assert
    expect(act).toThrow();
  });

  it("rejects an invalid baseBranch value", () => {
    // Arrange
    const data = validData();
    data.input = { ...data.input, baseBranch: "has a space" };

    // Act
    const act = () => parseExecutionRunDocument("req-1", data);

    // Assert
    expect(act).toThrow();
  });

  it("rejects an invalid requestedAt timestamp", () => {
    // Arrange
    const data = validData();
    data.input = { ...data.input, requestedAt: "not-a-date" };

    // Act
    const act = () => parseExecutionRunDocument("req-1", data);

    // Assert
    expect(act).toThrow();
  });

  it("rejects an unsupported input.schemaVersion", () => {
    // Arrange
    const data = validData();
    data.input = { ...data.input, schemaVersion: 2 as 1 };

    // Act
    const act = () => parseExecutionRunDocument("req-1", data);

    // Assert
    expect(act).toThrow();
  });

  it("accepts a document that already carries a claim marker", () => {
    // Arrange
    const data = { ...validData(), claim: { claimId: "claim-1", claimedAt: Timestamp.now() } };

    // Act
    const result = parseExecutionRunDocument("req-1", data);

    // Assert
    expect(result.claim).toMatchObject({ claimId: "claim-1" });
  });

  it("rejects an incorrect input.eventType", () => {
    // Arrange
    const data = validData();
    data.input = { ...data.input, eventType: "ada.execution.other" as "ada.execution.requested" };

    // Act
    const act = () => parseExecutionRunDocument("req-1", data);

    // Assert
    expect(act).toThrow();
  });

  it("accepts a document that already carries a source revision record", () => {
    // Arrange
    const data = {
      ...validData(),
      sourceRevision: { headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", resolvedAt: Timestamp.now() },
    };

    // Act
    const result = parseExecutionRunDocument("req-1", data);

    // Assert
    expect(result.sourceRevision).toMatchObject({ headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef" });
  });

  it("accepts a document without a sourceRevision (not yet recorded)", () => {
    // Arrange
    const data = validData();

    // Act
    const act = () => parseExecutionRunDocument("req-1", data);

    // Assert
    expect(act).not.toThrow();
  });

  it("rejects a sourceRevision with an empty headSha", () => {
    // Arrange
    const data = { ...validData(), sourceRevision: { headSha: "", resolvedAt: Timestamp.now() } };

    // Act
    const act = () => parseExecutionRunDocument("req-1", data);

    // Assert
    expect(act).toThrow();
  });

  it("rejects a sourceRevision with a non-Timestamp resolvedAt", () => {
    // Arrange
    const data = {
      ...validData(),
      sourceRevision: { headSha: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef", resolvedAt: new Date().toISOString() },
    };

    // Act
    const act = () => parseExecutionRunDocument("req-1", data);

    // Assert
    expect(act).toThrow();
  });
});
