import { describe, expect, it } from "vitest";

import { moveCardAction } from "./moveCard";

describe("moveCardAction", () => {
  it("should return an error state for an invalid move request", async () => {
    // Arrange
    const invalidRequest = { toColumnId: "done", toIndex: 0 };

    // Act
    const result = await moveCardAction({ status: "idle" }, invalidRequest);

    // Assert
    expect(result.status).toBe("error");
  });

  it("should move the card and return the updated board on success", async () => {
    // Arrange
    const request = { cardId: "card-1", toColumnId: "done", toIndex: 0 };

    // Act
    const result = await moveCardAction({ status: "idle" }, request);

    // Assert
    expect(result.status).toBe("success");
    expect(result.board?.columns.find((column) => column.id === "done")?.cardIds).toContain("card-1");
  });
});
