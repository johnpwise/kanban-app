import { beforeEach, describe, expect, it, vi } from "vitest";

import { getBoard } from "@/lib/services/board";

import { GET } from "./route";

vi.mock("@/lib/services/board", () => ({ getBoard: vi.fn() }));

const getBoardMock = vi.mocked(getBoard);

function context(projectId: string) {
  return { params: Promise.resolve({ projectId }) };
}

describe("GET /api/projects/{projectId}/board", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return the board for an existing project", async () => {
    const board = { columns: [], cardsById: {} };
    getBoardMock.mockResolvedValue(board);

    const response = await GET(new Request("http://localhost/api/projects/project-one/board"), context("project-one"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(board);
  });

  it("should return 400 for an invalid project id", async () => {
    const response = await GET(new Request("http://localhost"), context("project/child"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "INVALID_PROJECT_ID", message: "The project id is invalid." },
    });
  });

  it("should return 404 when the project does not exist", async () => {
    getBoardMock.mockResolvedValue(null);

    const response = await GET(new Request("http://localhost"), context("missing-project"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "PROJECT_NOT_FOUND", message: "The project was not found." },
    });
  });

  it("should return a safe 500 response when the board read fails", async () => {
    getBoardMock.mockRejectedValue(new Error("credential details"));

    const response = await GET(new Request("http://localhost"), context("project-one"));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: { code: "BOARD_READ_FAILED", message: "Could not load the board." },
    });
  });
});
