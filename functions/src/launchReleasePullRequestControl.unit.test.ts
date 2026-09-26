import { describe, expect, it, vi } from "vitest";

import { launchReleasePullRequestControl } from "./launchReleasePullRequestControl";

import type { LaunchAdaReleasePullRequestControllerJob, LaunchAdaReleasePullRequestControllerJobResult } from "./launchReleasePullRequestControl";

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    releaseIntentId: "intent-1",
    ...overrides,
  };
}

function startResult(overrides: Record<string, unknown> = {}) {
  return {
    releaseBranch: "release/0.2.0",
    commitSha: "a".repeat(40),
    ...overrides,
  };
}

function fakeLaunchJob(
  result: LaunchAdaReleasePullRequestControllerJobResult = { operationName: "op-1" },
): LaunchAdaReleasePullRequestControllerJob {
  return vi.fn().mockResolvedValue(result);
}

describe("launchReleasePullRequestControl", () => {
  it("requests exactly one release-pr-controller launch for a start-completion transition", async () => {
    const launchJob = fakeLaunchJob();

    await launchReleasePullRequestControl({
      documentId: "intent-1",
      before: intent(),
      after: intent({ start: startResult() }),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ releaseIntentId: "intent-1" });
  });

  it("does not launch when start is absent after the update", async () => {
    const launchJob = fakeLaunchJob();

    await launchReleasePullRequestControl({
      documentId: "intent-1",
      before: intent(),
      after: intent(),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch a second time when an already-started intent is updated again (e.g. pullRequests write)", async () => {
    const launchJob = fakeLaunchJob();

    await launchReleasePullRequestControl({
      documentId: "intent-1",
      before: intent({ start: startResult() }),
      after: intent({ start: startResult(), pullRequests: { main: { number: 1 } } }),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch a malformed document, and does not treat it as an error-worthy condition", async () => {
    const launchJob = fakeLaunchJob();
    const logger = fakeLogger();

    await launchReleasePullRequestControl({
      documentId: "intent-1",
      before: intent(),
      after: { releaseIntentId: "intent-1", start: "not-an-object" },
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it("does not launch when the document id does not match the after snapshot's releaseIntentId", async () => {
    const launchJob = fakeLaunchJob();

    await launchReleasePullRequestControl({
      documentId: "intent-2",
      before: intent({ releaseIntentId: "intent-1" }),
      after: intent({ releaseIntentId: "intent-1", start: startResult() }),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("logs only safe identifiers on a successful launch", async () => {
    const launchJob = fakeLaunchJob({ operationName: "projects/p/locations/l/operations/op-9" });
    const logger = fakeLogger();

    await launchReleasePullRequestControl({
      documentId: "intent-1",
      before: intent(),
      after: intent({ start: startResult() }),
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        releaseIntentId: "intent-1",
        eventId: "event-1",
        operationName: "projects/p/locations/l/operations/op-9",
      }),
    );
  });

  it("rethrows a transient launcher failure so the platform retries", async () => {
    const launchJob: LaunchAdaReleasePullRequestControllerJob = vi.fn().mockRejectedValue(new Error("network blip"));

    await expect(
      launchReleasePullRequestControl({
        documentId: "intent-1",
        before: intent(),
        after: intent({ start: startResult() }),
        eventId: "event-1",
        launchJob,
        logger: fakeLogger(),
      }),
    ).rejects.toThrow("network blip");
  });

  it.each([
    ["permission", 7],
    ["missing-resource", 5],
    ["invalid-configuration (invalid argument)", 3],
    ["invalid-configuration (failed precondition)", 9],
  ])("classifies a %s launcher error and acknowledges without retry", async (_label, code) => {
    const launchJob: LaunchAdaReleasePullRequestControllerJob = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { code }));
    const logger = fakeLogger();

    await launchReleasePullRequestControl({
      documentId: "intent-1",
      before: intent(),
      after: intent({ start: startResult() }),
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(logger.error).toHaveBeenCalled();
    expect(launchJob).toHaveBeenCalledTimes(1);
  });
});
