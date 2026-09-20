import { describe, expect, it } from "vitest";

import { dispatchAdaExecutionRequest } from "./index";

describe("dispatchAdaExecutionRequest", () => {
  it("should enable retries so transient publish failures are redelivered instead of dropped", () => {
    expect(dispatchAdaExecutionRequest.__endpoint.eventTrigger?.retry).toBe(true);
  });

  it("should stay bound to the executionRequests collection in europe-west2", () => {
    expect(dispatchAdaExecutionRequest.__endpoint.eventTrigger?.eventFilterPathPatterns).toMatchObject({
      document: "executionRequests/{executionRequestId}",
    });
    expect(dispatchAdaExecutionRequest.__endpoint.region).toEqual(["europe-west2"]);
  });
});
