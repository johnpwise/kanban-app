import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteCard } from "@/lib/services/board";

import { deleteCardAction } from "./deleteCard";

vi.mock("@/lib/services/board", () => ({ deleteCard: vi.fn() }));

const deleteCardMock = vi.mocked(deleteCard);

describe("deleteCardAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return an error state for an invalid delete request", async () => {
    // Arrange
    const invalidRequest = {};

    // Act
    const result = await deleteCardAction({ status: "idle" }, "project-one", invalidRequest);

    // Assert
    expect(result.status).toBe("error");
  });

  it("should delete the card and return the updated board on success", async () => {
    // Arrange
    const request = { cardId: "card-2" };

    // Act
    deleteCardMock.mockResolvedValue({
      columns: [{ id: "todo", title: "To Do", cardIds: [] }],
      cardsById: {},
    });
    const result = await deleteCardAction({ status: "idle" }, "project-one", request);

    // Assert
    expect(result.status).toBe("success");
    expect(result.board?.cardsById["card-2"]).toBeUndefined();
    expect(deleteCardMock).toHaveBeenCalledWith("project-one", request);
  });
});
