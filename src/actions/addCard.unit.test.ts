import { describe, expect, it } from "vitest";

import { addCardAction } from "./addCard";

describe("addCardAction", () => {
  it("should return an error state for an invalid add-card request", async () => {
    // Arrange
    const invalidRequest = { cardId: "card-9", columnId: "todo", title: "", label: null };

    // Act
    const result = await addCardAction({ status: "idle" }, invalidRequest);

    // Assert
    expect(result.status).toBe("error");
  });

  it("should add the card and return the updated board on success", async () => {
    // Arrange
    const request = { cardId: "card-9", columnId: "todo", title: "New task", label: "chore" };

    // Act
    const result = await addCardAction({ status: "idle" }, request);

    // Assert
    expect(result.status).toBe("success");
    expect(result.board?.columns.find((column) => column.id === "todo")?.cardIds).toContain("card-9");
    expect(result.board?.cardsById["card-9"]).toMatchObject({
      id: "card-9",
      title: "New task",
      label: "chore",
      notes: null,
      dueDate: null,
    });
  });
});
