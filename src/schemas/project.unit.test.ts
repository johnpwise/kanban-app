import { describe, expect, it } from "vitest";

import { projectIdSchema, projectNameSchema, projectSchema } from "./project";

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

describe("projectSchema", () => {
  it("should expose an ISO timestamp at the repository boundary", () => {
    const result = projectSchema.safeParse({
      id: "R7pQ2mK9xV4nL8cB",
      name: "Launch plan",
      createdAt: "2026-09-19T09:30:00.000Z",
    });

    expect(result.success).toBe(true);
  });
});
