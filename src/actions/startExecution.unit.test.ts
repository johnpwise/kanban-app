import { beforeEach, describe, expect, it, vi } from "vitest";

import { getBoard } from "@/lib/services/board";
import { getCurrentUser } from "@/lib/services/session";

import { startExecutionAction } from "./startExecution";

import type { Board } from "@/schemas/board";

vi.mock("@/lib/services/board", () => ({ getBoard: vi.fn() }));
vi.mock("@/lib/services/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/services/execution", () => {
  class ExecutionProjectNotFoundError extends Error {}
  class ExecutionCardNotFoundError extends Error {}
  class ExecutionNotAllowedError extends Error {}

  return {
    requestExecution: vi.fn(),
    ExecutionProjectNotFoundError,
    ExecutionCardNotFoundError,
    ExecutionNotAllowedError,
  };
});

const {
  requestExecution,
  ExecutionProjectNotFoundError,
  ExecutionCardNotFoundError,
  ExecutionNotAllowedError,
} = await import("@/lib/services/execution");

const requestExecutionMock = vi.mocked(requestExecution);
const getBoardMock = vi.mocked(getBoard);
const getCurrentUserMock = vi.mocked(getCurrentUser);

const board: Board = {
  columns: [{ id: "todo", title: "To Do", cardIds: ["card-1"] }],
  cardsById: {
    "card-1": {
      id: "card-1",
      title: "Wire up CI",
      label: "chore",
      createdAt: "2026-09-20T09:00:00.000Z",
      notes: null,
      dueDate: null,
      prompt: "Wire up continuous integration.",
      executionStatus: "queued",
      createdBy: "user-1",
      updatedAt: "2026-09-20T09:30:00.000Z",
    },
  },
};

describe("startExecutionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({ uid: "user-1", email: "person@example.com" });
    requestExecutionMock.mockResolvedValue({
      id: "execution-request-1",
      projectId: "project-one",
      cardId: "card-1",
      title: "Wire up CI",
      prompt: "Wire up continuous integration.",
      repository: "johnpwise/kanban-app",
      baseBranch: "develop",
      requestedBy: "user-1",
      requestedAt: "2026-09-20T09:30:00.000Z",
    });
    getBoardMock.mockResolvedValue(board);
  });

  it("should reject an unauthenticated request without calling requestExecution", async () => {
    // Arrange
    getCurrentUserMock.mockResolvedValue(null);

    // Act
    const result = await startExecutionAction({ status: "idle" }, "project-one", "card-1");

    // Assert
    expect(result.status).toBe("error");
    expect(requestExecutionMock).not.toHaveBeenCalled();
  });

  it("should reject an invalid project id without calling requestExecution", async () => {
    // Act
    const result = await startExecutionAction({ status: "idle" }, "project/child", "card-1");

    // Assert
    expect(result.status).toBe("error");
    expect(requestExecutionMock).not.toHaveBeenCalled();
  });

  it("should reject a blank card id without calling requestExecution", async () => {
    // Act
    const result = await startExecutionAction({ status: "idle" }, "project-one", "");

    // Assert
    expect(result.status).toBe("error");
    expect(requestExecutionMock).not.toHaveBeenCalled();
  });

  it("should call requestExecution with the verified session uid as requestedBy, never a client value", async () => {
    // Act
    await startExecutionAction({ status: "idle" }, "project-one", "card-1");

    // Assert
    expect(requestExecutionMock).toHaveBeenCalledWith({
      projectId: "project-one",
      cardId: "card-1",
      requestedBy: "user-1",
    });
  });

  it("should return the refreshed board on success", async () => {
    // Act
    const result = await startExecutionAction({ status: "idle" }, "project-one", "card-1");

    // Assert
    expect(result).toEqual({ status: "success", board });
    expect(getBoardMock).toHaveBeenCalledWith("project-one");
  });

  it("should map a missing project or card to a safe, specific message", async () => {
    // Arrange
    requestExecutionMock.mockRejectedValue(new ExecutionProjectNotFoundError("not found"));

    // Act
    const result = await startExecutionAction({ status: "idle" }, "project-one", "card-1");

    // Assert
    expect(result).toEqual({ status: "error", message: "This card is no longer available." });
  });

  it("should map a missing card to a safe, specific message", async () => {
    // Arrange
    requestExecutionMock.mockRejectedValue(new ExecutionCardNotFoundError("project-one", "card-1"));

    // Act
    const result = await startExecutionAction({ status: "idle" }, "project-one", "card-1");

    // Assert
    expect(result).toEqual({ status: "error", message: "This card is no longer available." });
  });

  it("should map a card that is no longer not_started to a safe, specific message", async () => {
    // Arrange
    requestExecutionMock.mockRejectedValue(new ExecutionNotAllowedError("card-1", "queued"));

    // Act
    const result = await startExecutionAction({ status: "idle" }, "project-one", "card-1");

    // Assert
    expect(result).toEqual({
      status: "error",
      message: "ADA work has already been started for this card.",
    });
  });

  it("should map an unexpected failure to a generic safe message and log it server-side", async () => {
    // Arrange
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    requestExecutionMock.mockRejectedValue(new Error("firestore is unreachable"));

    // Act
    const result = await startExecutionAction({ status: "idle" }, "project-one", "card-1");

    // Assert
    expect(result).toEqual({
      status: "error",
      message: "Could not start ADA work. Please try again.",
    });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
