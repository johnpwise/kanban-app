import { describe, expect, it } from "vitest";

import { noopDownstreamWork } from "./downstreamWork";

describe("noopDownstreamWork", () => {
  it("resolves without doing anything for a live workspace context", async () => {
    // Arrange
    const context = { workspacePath: "/tmp/whatever", headSha: "a".repeat(40) };

    // Act / Assert
    await expect(noopDownstreamWork(context)).resolves.toBeUndefined();
  });
});
