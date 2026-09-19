import { beforeEach, describe, expect, it, vi } from "vitest";

import { moveCard } from "@/lib/services/board";
import { getCurrentUser } from "@/lib/services/session";

import { moveCardAction } from "./moveCard";

vi.mock("@/lib/services/board", () => ({ moveCard: vi.fn() }));
vi.mock("@/lib/services/session", () => ({ getCurrentUser: vi.fn() }));

const moveCardMock = vi.mocked(moveCard);
const getCurrentUserMock = vi.mocked(getCurrentUser);

describe("moveCardAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({ uid: "user-1", email: "person@example.com" });
  });

  it("should return an error state when no user is signed in", async () => {
    // Arrange
    getCurrentUserMock.mockResolvedValue(null);

    // Act
    const result = await moveCardAction({ status: "idle" }, "project-one", {
      cardId: "card-1",
      toColumnId: "done",
      toIndex: 0,
    });

    // Assert
    expect(result.status).toBe("error");
    expect(moveCardMock).not.toHaveBeenCalled();
  });

  it("should return an error state for an invalid move request", async () => {
    // Arrange
    const invalidRequest = { toColumnId: "done", toIndex: 0 };

    // Act
    const result = await moveCardAction({ status: "idle" }, "project-one", invalidRequest);

    // Assert
    expect(result.status).toBe("error");
  });

  it("should move the card and return the updated board on success", async () => {
    // Arrange
    const request = { cardId: "card-1", toColumnId: "done", toIndex: 0 };

    // Act
    moveCardMock.mockResolvedValue({
      columns: [{ id: "done", title: "Done", cardIds: ["card-1"] }],
      cardsById: {
        "card-1": {
          id: "card-1",
          title: "Moved card",
          label: null,
          createdAt: "2026-09-19T09:30:00.000Z",
          notes: null,
          dueDate: null,
        },
      },
    });
    const result = await moveCardAction({ status: "idle" }, "project-one", request);

    // Assert
    expect(result.status).toBe("success");
    expect(result.board?.columns.find((column) => column.id === "done")?.cardIds).toContain("card-1");
    expect(moveCardMock).toHaveBeenCalledWith("project-one", request);
  });
});
