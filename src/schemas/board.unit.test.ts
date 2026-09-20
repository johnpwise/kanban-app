import { describe, expect, it } from "vitest";

import { addCardRequestSchema, cardSchema, moveCardRequestSchema, updateCardRequestSchema } from "./board";

describe("moveCardRequestSchema", () => {
  it("should accept a well-formed move request", () => {
    // Arrange
    const input = { cardId: "card-1", toColumnId: "done", toIndex: 0 };

    // Act
    const result = moveCardRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject a request missing a destination column", () => {
    // Arrange
    const input = { cardId: "card-1", toIndex: 0 };

    // Act
    const result = moveCardRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject a negative index", () => {
    // Arrange
    const input = { cardId: "card-1", toColumnId: "done", toIndex: -1 };

    // Act
    const result = moveCardRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("addCardRequestSchema", () => {
  it("should accept a well-formed add-card request", () => {
    // Arrange
    const input = {
      cardId: "card-9",
      columnId: "todo",
      title: "Write more tests",
      label: "chore",
      prompt: "Add unit tests for the new schema fields.",
    };

    // Act
    const result = addCardRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject a request with a blank title", () => {
    // Arrange
    const input = { cardId: "card-9", columnId: "todo", title: "", label: null, prompt: "Do the thing." };

    // Act
    const result = addCardRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject a request missing a column id", () => {
    // Arrange
    const input = { cardId: "card-9", title: "Write more tests", label: null, prompt: "Do the thing." };

    // Act
    const result = addCardRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject a request with a blank prompt", () => {
    // Arrange
    const input = { cardId: "card-9", columnId: "todo", title: "Write more tests", label: null, prompt: "" };

    // Act
    const result = addCardRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("cardSchema", () => {
  it("should accept a well-formed ADA task card", () => {
    // Arrange
    const input = {
      id: "card-1",
      title: "Write more tests",
      label: null,
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Add unit tests for the new schema fields.",
      executionStatus: "not_started",
      createdBy: "user-1",
      updatedAt: "2026-01-05T09:00:00.000Z",
    };

    // Act
    const result = cardSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject an unrecognized execution status", () => {
    // Arrange
    const input = {
      id: "card-1",
      title: "Write more tests",
      label: null,
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Add unit tests for the new schema fields.",
      executionStatus: "in_review",
      createdBy: "user-1",
      updatedAt: "2026-01-05T09:00:00.000Z",
    };

    // Act
    const result = cardSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject a card missing createdBy", () => {
    // Arrange
    const input = {
      id: "card-1",
      title: "Write more tests",
      label: null,
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Add unit tests for the new schema fields.",
      executionStatus: "not_started",
      createdBy: "",
      updatedAt: "2026-01-05T09:00:00.000Z",
    };

    // Act
    const result = cardSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("updateCardRequestSchema", () => {
  it("should accept a well-formed update request with a due date", () => {
    // Arrange
    const input = { cardId: "card-1", notes: "Check with design", dueDate: "2026-02-01" };

    // Act
    const result = updateCardRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should accept a null due date", () => {
    // Arrange
    const input = { cardId: "card-1", notes: "", dueDate: null };

    // Act
    const result = updateCardRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject a request missing a card id", () => {
    // Arrange
    const input = { notes: "Check with design", dueDate: null };

    // Act
    const result = updateCardRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});
