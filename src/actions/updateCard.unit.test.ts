import { describe, expect, it } from "vitest";

import { updateCardAction } from "./updateCard";

describe("updateCardAction", () => {
  it("should return an error state for an invalid update request", async () => {
    // Arrange
    const invalidRequest = { notes: "Check with design", dueDate: null };

    // Act
    const result = await updateCardAction({ status: "idle" }, invalidRequest);

    // Assert
    expect(result.status).toBe("error");
  });

  it("should update the card and return the updated board on success", async () => {
    // Arrange
    const request = { cardId: "card-1", notes: "Check with design", dueDate: "2026-02-01" };

    // Act
    const result = await updateCardAction({ status: "idle" }, request);

    // Assert
    expect(result.status).toBe("success");
    expect(result.board?.cardsById["card-1"]).toMatchObject({ notes: "Check with design", dueDate: "2026-02-01" });
  });

  it("should return an error state when the card does not exist", async () => {
    // Arrange
    const request = { cardId: "missing-card", notes: "", dueDate: null };

    // Act
    const result = await updateCardAction({ status: "idle" }, request);

    // Assert
    expect(result.status).toBe("error");
  });
});
