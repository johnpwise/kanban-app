import { describe, expect, it } from "vitest";

import {
  createProjectRequestSchema,
  defaultBranchSchema,
  githubRepositorySchema,
  projectIdSchema,
  projectNameSchema,
  projectSchema,
} from "./project";

describe("projectNameSchema", () => {
  it("should trim and accept a project name between 1 and 80 characters", () => {
    expect(projectNameSchema.parse("  Launch plan  ")).toBe("Launch plan");
  });

  it("should reject an empty project name after trimming", () => {
    expect(projectNameSchema.safeParse("   ").success).toBe(false);
  });

  it("should reject a project name longer than 80 characters", () => {
    expect(projectNameSchema.safeParse("a".repeat(81)).success).toBe(false);
  });
});

describe("projectIdSchema", () => {
  it("should accept an opaque Firestore document id", () => {
    expect(projectIdSchema.safeParse("R7pQ2mK9xV4nL8cB").success).toBe(true);
  });

  it("should reject ids that could address nested Firestore paths", () => {
    expect(projectIdSchema.safeParse("project/child").success).toBe(false);
  });

  it("should reject Firestore's reserved relative document ids", () => {
    expect(projectIdSchema.safeParse(".").success).toBe(false);
    expect(projectIdSchema.safeParse("..").success).toBe(false);
  });

  it("should enforce Firestore's 1,500-byte document id limit", () => {
    expect(projectIdSchema.safeParse("é".repeat(751)).success).toBe(false);
  });
});

describe("githubRepositorySchema", () => {
  it("should accept an owner/repository identifier", () => {
    expect(githubRepositorySchema.safeParse("johnpwise/kanban-app").success).toBe(true);
  });

  it("should reject a value missing the owner/repository slash", () => {
    expect(githubRepositorySchema.safeParse("kanban-app").success).toBe(false);
  });

  it("should reject a value with more than one slash", () => {
    expect(githubRepositorySchema.safeParse("johnpwise/kanban-app/extra").success).toBe(false);
  });

  it("should reject an owner starting or ending with a hyphen", () => {
    expect(githubRepositorySchema.safeParse("-johnpwise/kanban-app").success).toBe(false);
    expect(githubRepositorySchema.safeParse("johnpwise-/kanban-app").success).toBe(false);
  });

  it("should reject an empty repository value", () => {
    expect(githubRepositorySchema.safeParse("").success).toBe(false);
  });
});

describe("defaultBranchSchema", () => {
  it("should accept a non-empty branch name", () => {
    expect(defaultBranchSchema.parse("develop")).toBe("develop");
  });

  it("should reject an empty branch name", () => {
    expect(defaultBranchSchema.safeParse("   ").success).toBe(false);
  });

  it("should reject a branch name containing spaces", () => {
    expect(defaultBranchSchema.safeParse("feature branch").success).toBe(false);
  });

  it("should reject a branch name longer than 255 characters", () => {
    expect(defaultBranchSchema.safeParse("a".repeat(256)).success).toBe(false);
  });
});

describe("projectSchema", () => {
  it("should expose an ISO timestamp and GitHub execution context at the repository boundary", () => {
    const result = projectSchema.safeParse({
      id: "R7pQ2mK9xV4nL8cB",
      name: "Launch plan",
      repository: "johnpwise/kanban-app",
      defaultBranch: "develop",
      createdAt: "2026-09-19T09:30:00.000Z",
    });

    expect(result.success).toBe(true);
  });
});

describe("createProjectRequestSchema", () => {
  it("should accept a valid project creation request", () => {
    const result = createProjectRequestSchema.safeParse({
      name: "Launch plan",
      repository: "johnpwise/kanban-app",
      defaultBranch: "develop",
    });

    expect(result.success).toBe(true);
  });

  it("should reject an invalid repository value", () => {
    const result = createProjectRequestSchema.safeParse({
      name: "Launch plan",
      repository: "not-a-repo",
      defaultBranch: "develop",
    });

    expect(result.success).toBe(false);
  });
});
