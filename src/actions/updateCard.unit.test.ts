import { beforeEach, describe, expect, it, vi } from "vitest";

import { updateCard } from "@/lib/services/board";

import { updateCardAction } from "./updateCard";

vi.mock("@/lib/services/board", () => ({ updateCard: vi.fn() }));

const updateCardMock = vi.mocked(updateCard);

describe("updateCardAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return an error state for an invalid update request", async () => {
    // Arrange
    const invalidRequest = { notes: "Check with design", dueDate: null };

    // Act
    const result = await updateCardAction({ status: "idle" }, "project-one", invalidRequest);

    // Assert
    expect(result.status).toBe("error");
  });

  it("should update the card and return the updated board on success", async () => {
    // Arrange
    const request = { cardId: "card-1", notes: "Check with design", dueDate: "2026-02-01" };

    // Act
    updateCardMock.mockResolvedValue({
      columns: [{ id: "todo", title: "To Do", cardIds: ["card-1"] }],
      cardsById: {
        "card-1": {
          id: "card-1",
          title: "Card",
          label: null,
          createdAt: "2026-09-19T09:30:00.000Z",
          notes: "Check with design",
          dueDate: "2026-02-01",
        },
      },
    });
    const result = await updateCardAction({ status: "idle" }, "project-one", request);

    // Assert
    expect(result.status).toBe("success");
    expect(result.board?.cardsById["card-1"]).toMatchObject({ notes: "Check with design", dueDate: "2026-02-01" });
  });

  it("should return an error state when the card does not exist", async () => {
    // Arrange
    const request = { cardId: "missing-card", notes: "", dueDate: null };

    // Act
    updateCardMock.mockRejectedValue(new Error("missing"));
    const result = await updateCardAction({ status: "idle" }, "project-one", request);

    // Assert
    expect(result.status).toBe("error");
  });
});
