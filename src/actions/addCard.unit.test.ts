import { beforeEach, describe, expect, it, vi } from "vitest";

import { addCard } from "@/lib/services/board";
import { getCurrentUser } from "@/lib/services/session";

import { addCardAction } from "./addCard";

vi.mock("@/lib/services/board", () => ({ addCard: vi.fn() }));
vi.mock("@/lib/services/session", () => ({ getCurrentUser: vi.fn() }));

const addCardMock = vi.mocked(addCard);
const getCurrentUserMock = vi.mocked(getCurrentUser);

describe("addCardAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({ uid: "user-1", email: "person@example.com" });
  });

  it("should return an error state when no user is signed in", async () => {
    // Arrange
    getCurrentUserMock.mockResolvedValue(null);

    // Act
    const result = await addCardAction({ status: "idle" }, "project-one", {
      cardId: "card-9",
      columnId: "todo",
      title: "New task",
      label: null,
    });

    // Assert
    expect(result.status).toBe("error");
    expect(addCardMock).not.toHaveBeenCalled();
  });

  it("should return an error state for an invalid add-card request", async () => {
    // Arrange
    const invalidRequest = { cardId: "card-9", columnId: "todo", title: "", label: null };

    // Act
    const result = await addCardAction({ status: "idle" }, "project-one", invalidRequest);

    // Assert
    expect(result.status).toBe("error");
  });

  it("should add the card and return the updated board on success", async () => {
    // Arrange
    const request = { cardId: "card-9", columnId: "todo", title: "New task", label: "chore" };

    // Act
    addCardMock.mockResolvedValue({
      columns: [{ id: "todo", title: "To Do", cardIds: ["card-9"] }],
      cardsById: {
        "card-9": {
          id: "card-9",
          title: "New task",
          label: "chore",
          createdAt: "2026-09-19T09:30:00.000Z",
          notes: null,
          dueDate: null,
        },
      },
    });

    const result = await addCardAction({ status: "idle" }, "project-one", request);

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
    expect(addCardMock).toHaveBeenCalledWith("project-one", request);
  });

  it("should reject an invalid project id", async () => {
    const result = await addCardAction({ status: "idle" }, "project/child", {
      cardId: "card-9",
      columnId: "todo",
      title: "New task",
      label: null,
    });

    expect(result.status).toBe("error");
    expect(addCardMock).not.toHaveBeenCalled();
  });
});
