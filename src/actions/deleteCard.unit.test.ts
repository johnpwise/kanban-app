import { describe, expect, it } from "vitest";

import { deleteCardAction } from "./deleteCard";

describe("deleteCardAction", () => {
  it("should return an error state for an invalid delete request", async () => {
    // Arrange
    const invalidRequest = {};

    // Act
    const result = await deleteCardAction({ status: "idle" }, invalidRequest);

    // Assert
    expect(result.status).toBe("error");
  });

  it("should delete the card and return the updated board on success", async () => {
    // Arrange
    const request = { cardId: "card-2" };

    // Act
    const result = await deleteCardAction({ status: "idle" }, request);

    // Assert
    expect(result.status).toBe("success");
    expect(result.board?.cardsById["card-2"]).toBeUndefined();
  });
});
