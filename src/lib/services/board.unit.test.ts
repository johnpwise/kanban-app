import { describe, expect, it } from "vitest";

import {
  addCardToBoard,
  deleteCardFromBoard,
  moveCardInBoard,
  updateCardInBoard,
} from "@/lib/domain/board";

import type { Board } from "@/schemas/board";

const board: Board = {
  columns: [
    { id: "todo", title: "To Do", cardIds: ["card-1", "card-2"] },
    { id: "done", title: "Done", cardIds: [] },
  ],
  cardsById: {
    "card-1": {
      id: "card-1",
      title: "First card",
      label: null,
      createdAt: "2026-01-05T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Do the first thing.",
      executionStatus: "not_started",
      createdBy: "user-1",
      updatedAt: "2026-01-05T09:00:00.000Z",
    },
    "card-2": {
      id: "card-2",
      title: "Second card",
      label: null,
      createdAt: "2026-01-06T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Do the second thing.",
      executionStatus: "not_started",
      createdBy: "user-1",
      updatedAt: "2026-01-06T09:00:00.000Z",
    },
  },
};

describe("moveCardInBoard", () => {
  it("should move a card into a different column", () => {
    // Arrange
    const request = { cardId: "card-1", toColumnId: "done", toIndex: 0 };

    // Act
    const result = moveCardInBoard(board, request);

    // Assert
    expect(result.columns.find((column) => column.id === "todo")?.cardIds).toEqual(["card-2"]);
    expect(result.columns.find((column) => column.id === "done")?.cardIds).toEqual(["card-1"]);
  });

  it("should reorder a card within the same column", () => {
    // Arrange
    const request = { cardId: "card-2", toColumnId: "todo", toIndex: 0 };

    // Act
    const result = moveCardInBoard(board, request);

    // Assert
    expect(result.columns.find((column) => column.id === "todo")?.cardIds).toEqual(["card-2", "card-1"]);
  });

  it("should throw when the card does not exist on the board", () => {
    // Arrange
    const request = { cardId: "missing-card", toColumnId: "done", toIndex: 0 };

    // Act
    const moveMissingCard = () => moveCardInBoard(board, request);

    // Assert
    expect(moveMissingCard).toThrow('Card "missing-card" was not found on the board.');
  });

  it("should throw when the destination column does not exist", () => {
    // Arrange
    const request = { cardId: "card-1", toColumnId: "missing-column", toIndex: 0 };

    // Act
    const moveToMissingColumn = () => moveCardInBoard(board, request);

    // Assert
    expect(moveToMissingColumn).toThrow('Column "missing-column" was not found on the board.');
  });
});

describe("addCardToBoard", () => {
  it("should append a new card to the target column", () => {
    // Arrange
    const request = { cardId: "card-3", columnId: "todo", title: "Third card", label: null, prompt: "Do the third thing." };

    // Act
    const result = addCardToBoard(board, request, "user-2");

    // Assert
    expect(result.columns.find((column) => column.id === "todo")?.cardIds).toEqual(["card-1", "card-2", "card-3"]);
    expect(result.cardsById["card-3"]).toMatchObject({
      id: "card-3",
      title: "Third card",
      label: null,
      notes: null,
      dueDate: null,
      prompt: "Do the third thing.",
      executionStatus: "not_started",
      createdBy: "user-2",
    });
    expect(result.cardsById["card-3"]?.createdAt).toEqual(expect.any(String));
    expect(result.cardsById["card-3"]?.updatedAt).toEqual(expect.any(String));
  });

  it("should throw when the target column does not exist", () => {
    // Arrange
    const request = { cardId: "card-3", columnId: "missing-column", title: "Third card", label: null, prompt: "Do the third thing." };

    // Act
    const addToMissingColumn = () => addCardToBoard(board, request, "user-2");

    // Assert
    expect(addToMissingColumn).toThrow('Column "missing-column" was not found on the board.');
  });

  it("should throw when a card with the same id already exists", () => {
    // Arrange
    const request = { cardId: "card-1", columnId: "todo", title: "Duplicate card", label: null, prompt: "Do the third thing." };

    // Act
    const addDuplicateCard = () => addCardToBoard(board, request, "user-2");

    // Assert
    expect(addDuplicateCard).toThrow('Card "card-1" already exists on the board.');
  });
});

describe("deleteCardFromBoard", () => {
  it("should remove the card from its column and from cardsById", () => {
    // Arrange
    const request = { cardId: "card-1" };

    // Act
    const result = deleteCardFromBoard(board, request);

    // Assert
    expect(result.columns.find((column) => column.id === "todo")?.cardIds).toEqual(["card-2"]);
    expect(result.cardsById["card-1"]).toBeUndefined();
  });

  it("should throw when the card does not exist on the board", () => {
    // Arrange
    const request = { cardId: "missing-card" };

    // Act
    const deleteMissingCard = () => deleteCardFromBoard(board, request);

    // Assert
    expect(deleteMissingCard).toThrow('Card "missing-card" was not found on the board.');
  });
});

describe("updateCardInBoard", () => {
  it("should update the notes and due date on the target card", () => {
    // Arrange
    const request = { cardId: "card-1", notes: "Check with design", dueDate: "2026-02-01" };

    // Act
    const result = updateCardInBoard(board, request);

    // Assert
    expect(result.cardsById["card-1"]).toMatchObject({ notes: "Check with design", dueDate: "2026-02-01" });
  });

  it("should refresh updatedAt on the target card", () => {
    // Arrange
    const request = { cardId: "card-1", notes: "Check with design", dueDate: "2026-02-01" };

    // Act
    const result = updateCardInBoard(board, request);

    // Assert
    expect(result.cardsById["card-1"]?.updatedAt).not.toEqual(board.cardsById["card-1"]?.updatedAt);
  });

  it("should clear the due date when given null", () => {
    // Arrange
    const withDueDate = updateCardInBoard(board, { cardId: "card-1", notes: "", dueDate: "2026-02-01" });
    const request = { cardId: "card-1", notes: "", dueDate: null };

    // Act
    const result = updateCardInBoard(withDueDate, request);

    // Assert
    expect(result.cardsById["card-1"]?.dueDate).toBeNull();
  });

  it("should not change the card's title, label, or createdAt", () => {
    // Arrange
    const request = { cardId: "card-1", notes: "Check with design", dueDate: null };

    // Act
    const result = updateCardInBoard(board, request);

    // Assert
    expect(result.cardsById["card-1"]).toMatchObject({
      title: "First card",
      label: null,
      createdAt: "2026-01-05T09:00:00.000Z",
    });
  });

  it("should throw when the card does not exist on the board", () => {
    // Arrange
    const request = { cardId: "missing-card", notes: "", dueDate: null };

    // Act
    const updateMissingCard = () => updateCardInBoard(board, request);

    // Assert
    expect(updateMissingCard).toThrow('Card "missing-card" was not found on the board.');
  });
});
