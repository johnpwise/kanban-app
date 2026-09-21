import { describe, expect, it } from "vitest";

import { acceptAdaExecutionRun, dispatchAdaExecutionRequest, launchAdaExecutionRun } from "./index";
import { dispatchTopicName } from "./onExecutionRequestCreated";

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

describe("acceptAdaExecutionRun", () => {
  it("should enable retries so transient acceptance failures are redelivered instead of dropped", () => {
    expect(acceptAdaExecutionRun.__endpoint.eventTrigger?.retry).toBe(true);
  });

  it("should stay bound to the same configurable topic as the dispatcher, in europe-west2", () => {
    // Passed as the raw param (not `.value()`) so Firebase's deploy tooling resolves it, per
    // firebase-functions' own guidance; `.value()` only resolves from `process.env` at runtime.
    expect(acceptAdaExecutionRun.__endpoint.eventTrigger?.eventFilters).toMatchObject({
      topic: dispatchTopicName,
    });
    expect(acceptAdaExecutionRun.__endpoint.region).toEqual(["europe-west2"]);
  });
});

describe("launchAdaExecutionRun", () => {
  it("should enable retries so a transient launch failure is redelivered instead of dropped", () => {
    expect(launchAdaExecutionRun.__endpoint.eventTrigger?.retry).toBe(true);
  });

  it("should stay bound to the executionRuns collection in europe-west2", () => {
    expect(launchAdaExecutionRun.__endpoint.eventTrigger?.eventFilterPathPatterns).toMatchObject({
      document: "executionRuns/{executionRequestId}",
    });
    expect(launchAdaExecutionRun.__endpoint.region).toEqual(["europe-west2"]);
  });
});
