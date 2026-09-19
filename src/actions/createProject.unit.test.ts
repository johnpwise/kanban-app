import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProject } from "@/lib/services/projects";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createProjectAction } from "./createProject";

vi.mock("@/lib/services/projects", () => ({ createProject: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const createProjectMock = vi.mocked(createProject);

describe("createProjectAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return a validation error for a blank project name", async () => {
    const formData = new FormData();
    formData.set("name", "   ");

    const result = await createProjectAction({ status: "idle" }, formData);

    expect(result).toEqual({ status: "error", message: "Enter a project name." });
    expect(createProjectMock).not.toHaveBeenCalled();
  });

  it("should create a trimmed project and navigate to its board", async () => {
    createProjectMock.mockResolvedValue({
      id: "opaque-project-id",
      name: "Launch plan",
      createdAt: "2026-09-19T09:30:00.000Z",
    });
    const formData = new FormData();
    formData.set("name", "  Launch plan  ");

    await createProjectAction({ status: "idle" }, formData);

    expect(createProjectMock).toHaveBeenCalledWith("Launch plan");
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(redirect).toHaveBeenCalledWith("/projects/opaque-project-id");
  });

  it("should return a safe error when Firestore project creation fails", async () => {
    createProjectMock.mockRejectedValue(new Error("credential details"));
    const formData = new FormData();
    formData.set("name", "Launch plan");

    const result = await createProjectAction({ status: "idle" }, formData);

    expect(result).toEqual({
      status: "error",
      message: "Could not create the project. Please try again.",
    });
  });
});
