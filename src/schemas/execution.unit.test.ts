import { describe, expect, it } from "vitest";

import { executionRequestSchema, requestExecutionInputSchema } from "./execution";

describe("executionRequestSchema", () => {
  it("should accept a fully populated execution request snapshot", () => {
    const result = executionRequestSchema.safeParse({
      id: "execution-request-1",
      projectId: "R7pQ2mK9xV4nL8cB",
      cardId: "card-1",
      title: "Wire up CI",
      prompt: "Wire up continuous integration for the kanban app repo.",
      repository: "johnpwise/kanban-app",
      baseBranch: "develop",
      requestedBy: "user-1",
      requestedAt: "2026-09-20T09:30:00.000Z",
    });

    expect(result.success).toBe(true);
  });

  it("should reject a repository value that is not owner/repository", () => {
    const result = executionRequestSchema.safeParse({
      id: "execution-request-1",
      projectId: "R7pQ2mK9xV4nL8cB",
      cardId: "card-1",
      title: "Wire up CI",
      prompt: "Wire up continuous integration for the kanban app repo.",
      repository: "kanban-app",
      baseBranch: "develop",
      requestedBy: "user-1",
      requestedAt: "2026-09-20T09:30:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("should reject a non-ISO requestedAt value", () => {
    const result = executionRequestSchema.safeParse({
      id: "execution-request-1",
      projectId: "R7pQ2mK9xV4nL8cB",
      cardId: "card-1",
      title: "Wire up CI",
      prompt: "Wire up continuous integration for the kanban app repo.",
      repository: "johnpwise/kanban-app",
      baseBranch: "develop",
      requestedBy: "user-1",
      requestedAt: "not-a-date",
    });

    expect(result.success).toBe(false);
  });
});

describe("requestExecutionInputSchema", () => {
  it("should accept a valid execution request input", () => {
    const result = requestExecutionInputSchema.safeParse({
      projectId: "R7pQ2mK9xV4nL8cB",
      cardId: "card-1",
      requestedBy: "user-1",
    });

    expect(result.success).toBe(true);
  });

  it("should reject a blank requestedBy", () => {
    const result = requestExecutionInputSchema.safeParse({
      projectId: "R7pQ2mK9xV4nL8cB",
      cardId: "card-1",
      requestedBy: "",
    });

    expect(result.success).toBe(false);
  });

  it("should reject an invalid project id", () => {
    const result = requestExecutionInputSchema.safeParse({
      projectId: "project/child",
      cardId: "card-1",
      requestedBy: "user-1",
    });

    expect(result.success).toBe(false);
  });
});
