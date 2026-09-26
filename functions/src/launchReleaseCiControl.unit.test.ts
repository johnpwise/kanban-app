import { describe, expect, it, vi } from "vitest";

import { launchReleaseCiControl } from "./launchReleaseCiControl";

import type { LaunchAdaReleaseCiControllerJob, LaunchAdaReleaseCiControllerJobResult } from "./launchReleaseCiControl";

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    releaseIntentId: "intent-1",
    ...overrides,
  };
}

function pullRequestResult(overrides: Record<string, unknown> = {}) {
  return {
    number: 64,
    baseBranch: "main",
    headBranch: "release/0.1.1",
    headSha: "a".repeat(40),
    ...overrides,
  };
}

function bothPullRequests() {
  return {
    pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) },
  };
}

function fakeLaunchJob(
  result: LaunchAdaReleaseCiControllerJobResult = { operationName: "op-1" },
): LaunchAdaReleaseCiControllerJob {
  return vi.fn().mockResolvedValue(result);
}

describe("launchReleaseCiControl", () => {
  it("requests exactly one release-ci-controller launch when develop completes a main-first pair", async () => {
    const launchJob = fakeLaunchJob();

    await launchReleaseCiControl({
      documentId: "intent-1",
      before: intent({ pullRequests: { main: pullRequestResult() } }),
      after: intent(bothPullRequests()),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ releaseIntentId: "intent-1" });
  });

  it("requests exactly one release-ci-controller launch when both PRs are recorded together", async () => {
    const launchJob = fakeLaunchJob();

    await launchReleaseCiControl({
      documentId: "intent-1",
      before: intent(),
      after: intent(bothPullRequests()),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ releaseIntentId: "intent-1" });
  });

  it("does not launch when only main is present after the update", async () => {
    const launchJob = fakeLaunchJob();

    await launchReleaseCiControl({
      documentId: "intent-1",
      before: intent(),
      after: intent({ pullRequests: { main: pullRequestResult() } }),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch when neither target is present after the update", async () => {
    const launchJob = fakeLaunchJob();

    await launchReleaseCiControl({
      documentId: "intent-1",
      before: intent(),
      after: intent(),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch again when an already-complete pair receives a later ci write", async () => {
    const launchJob = fakeLaunchJob();

    await launchReleaseCiControl({
      documentId: "intent-1",
      before: intent(bothPullRequests()),
      after: intent({
        ...bothPullRequests(),
        ci: { main: { ...pullRequestResult(), state: "succeeded", runId: 1, htmlUrl: "https://x" } },
      }),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch a malformed document, and does not treat it as an error-worthy condition", async () => {
    const launchJob = fakeLaunchJob();
    const logger = fakeLogger();

    await launchReleaseCiControl({
      documentId: "intent-1",
      before: intent(),
      after: { releaseIntentId: "intent-1", pullRequests: "not-an-object" },
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

    await launchReleaseCiControl({
      documentId: "intent-2",
      before: intent({ releaseIntentId: "intent-1" }),
      after: intent({ releaseIntentId: "intent-1", ...bothPullRequests() }),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("logs only safe identifiers on a successful launch", async () => {
    const launchJob = fakeLaunchJob({ operationName: "projects/p/locations/l/operations/op-9" });
    const logger = fakeLogger();

    await launchReleaseCiControl({
      documentId: "intent-1",
      before: intent(),
      after: intent(bothPullRequests()),
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
    const launchJob: LaunchAdaReleaseCiControllerJob = vi.fn().mockRejectedValue(new Error("network blip"));

    await expect(
      launchReleaseCiControl({
        documentId: "intent-1",
        before: intent(),
        after: intent(bothPullRequests()),
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
    const launchJob: LaunchAdaReleaseCiControllerJob = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { code }));
    const logger = fakeLogger();

    await launchReleaseCiControl({
      documentId: "intent-1",
      before: intent(),
      after: intent(bothPullRequests()),
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(logger.error).toHaveBeenCalled();
    expect(launchJob).toHaveBeenCalledTimes(1);
  });
});
