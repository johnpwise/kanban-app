import { describe, expect, it } from "vitest";

import { exitCodeForOutcome } from "./exitCode";

describe("exitCodeForOutcome", () => {
  it("returns 0 for a successful outcome", () => {
    // Arrange
    const outcome = { ok: true as const, claimed: true };

    // Act
    const code = exitCodeForOutcome(outcome);

    // Assert
    expect(code).toBe(0);
  });

  it("returns a non-zero code for a failed outcome", () => {
    // Arrange
    const outcome = { ok: false as const, reason: "not_found" };

    // Act
    const code = exitCodeForOutcome(outcome);

    // Assert
    expect(code).not.toBe(0);
  });
});
