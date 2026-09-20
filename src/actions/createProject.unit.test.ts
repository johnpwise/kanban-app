import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProject } from "@/lib/services/projects";
import { getCurrentUser } from "@/lib/services/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createProjectAction } from "./createProject";

vi.mock("@/lib/services/projects", () => ({ createProject: vi.fn() }));
vi.mock("@/lib/services/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const createProjectMock = vi.mocked(createProject);
const getCurrentUserMock = vi.mocked(getCurrentUser);

describe("createProjectAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({ uid: "user-1", email: "person@example.com" });
  });

  function buildFormData(overrides: Partial<Record<"name" | "repository" | "defaultBranch", string>> = {}) {
    const formData = new FormData();
    formData.set("name", overrides.name ?? "Launch plan");
    formData.set("repository", overrides.repository ?? "johnpwise/kanban-app");
    formData.set("defaultBranch", overrides.defaultBranch ?? "develop");
    return formData;
  }

  it("should return an error state when no user is signed in", async () => {
    // Arrange
    getCurrentUserMock.mockResolvedValue(null);
    const formData = buildFormData();

    // Act
    const result = await createProjectAction({ status: "idle" }, formData);

    // Assert
    expect(result).toEqual({ status: "error", message: "You must be signed in to create a project." });
    expect(createProjectMock).not.toHaveBeenCalled();
  });

  it("should return a validation error for a blank project name", async () => {
    const formData = buildFormData({ name: "   " });

    const result = await createProjectAction({ status: "idle" }, formData);

    expect(result).toEqual({ status: "error", message: "Enter a project name." });
    expect(createProjectMock).not.toHaveBeenCalled();
  });

  it("should return a validation error for an invalid GitHub repository", async () => {
    const formData = buildFormData({ repository: "not-a-repo" });

    const result = await createProjectAction({ status: "idle" }, formData);

    expect(result).toEqual({
      status: "error",
      message: "Enter the repository as owner/repository, e.g. johnpwise/kanban-app.",
    });
    expect(createProjectMock).not.toHaveBeenCalled();
  });

  it("should return a validation error for a blank default branch", async () => {
    const formData = buildFormData({ defaultBranch: "   " });

    const result = await createProjectAction({ status: "idle" }, formData);

    expect(result).toEqual({ status: "error", message: "Enter a default branch." });
    expect(createProjectMock).not.toHaveBeenCalled();
  });

  it("should create a trimmed project and navigate to its board", async () => {
    createProjectMock.mockResolvedValue({
      id: "opaque-project-id",
      name: "Launch plan",
      repository: "johnpwise/kanban-app",
      defaultBranch: "develop",
      createdAt: "2026-09-19T09:30:00.000Z",
    });
    const formData = buildFormData({ name: "  Launch plan  " });

    await createProjectAction({ status: "idle" }, formData);

    expect(createProjectMock).toHaveBeenCalledWith({
      name: "Launch plan",
      repository: "johnpwise/kanban-app",
      defaultBranch: "develop",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
    expect(redirect).toHaveBeenCalledWith("/projects/opaque-project-id");
  });

  it("should return a safe error when Firestore project creation fails", async () => {
    createProjectMock.mockRejectedValue(new Error("credential details"));
    const formData = buildFormData();

    const result = await createProjectAction({ status: "idle" }, formData);

    expect(result).toEqual({
      status: "error",
      message: "Could not create the project. Please try again.",
    });
  });
});
