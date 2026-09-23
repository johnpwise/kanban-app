import { describe, expect, it } from "vitest";

import { noopInvokeCodingAgent } from "./codingAgentInvocation";

describe("noopInvokeCodingAgent", () => {
  it("resolves without doing anything for a fully-populated invocation", async () => {
    // Arrange
    const invocation = {
      executionRequestId: "execution-request-id",
      task: {
        title: "task-title",
        prompt: "task-prompt",
      },
      workspace: {
        path: "/tmp/workspace-path",
        headSha: "a".repeat(40),
      },
    };

    // Act / Assert
    await expect(noopInvokeCodingAgent(invocation)).resolves.toBeUndefined();
  });
});
