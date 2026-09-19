import { describe, expect, it } from "vitest";

import { subscribeRequestSchema } from "./subscribe";

describe("subscribeRequestSchema", () => {
  it("should accept a well-formed email", () => {
    // Arrange
    const input = { email: "person@example.com" };

    // Act
    const result = subscribeRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject a malformed email", () => {
    // Arrange
    const input = { email: "not-an-email" };

    // Act
    const result = subscribeRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});
