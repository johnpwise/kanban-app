import { describe, expect, it, vi } from "vitest";

import { launchAdaMergeControl } from "./launchAdaMergeControl";

import type { LaunchAdaMergeControllerJob, LaunchAdaMergeControllerJobResult } from "./launchAdaMergeControl";

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function run(status: string, overrides: Record<string, unknown> = {}) {
  return {
    executionRequestId: "req-1",
    status,
    ...overrides,
  };
}

function fakeLaunchJob(result: LaunchAdaMergeControllerJobResult = { operationName: "op-1" }): LaunchAdaMergeControllerJob {
  return vi.fn().mockResolvedValue(result);
}

describe("launchAdaMergeControl", () => {
  it("requests exactly one merge-controller launch for a ci_succeeded transition", async () => {
    const launchJob = fakeLaunchJob();

    await launchAdaMergeControl({
      documentId: "req-1",
      before: run("accepted"),
      after: run("ci_succeeded"),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ executionRequestId: "req-1" });
  });

  it("does not launch when status is not ci_succeeded after the update", async () => {
    const launchJob = fakeLaunchJob();

    await launchAdaMergeControl({
      documentId: "req-1",
      before: run("accepted"),
      after: run("ci_failed"),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch a second time when an already-ci_succeeded run is updated again (e.g. merge write)", async () => {
    const launchJob = fakeLaunchJob();

    await launchAdaMergeControl({
      documentId: "req-1",
      before: run("ci_succeeded"),
      after: run("merged", { merge: { deliveryCommitSha: "a".repeat(40) } }),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch a malformed document, and does not treat it as an error-worthy condition", async () => {
    const launchJob = fakeLaunchJob();
    const logger = fakeLogger();

    await launchAdaMergeControl({
      documentId: "req-1",
      before: run("accepted"),
      after: { executionRequestId: "req-1", status: 42 },
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalled();
  });

  it("does not launch when the document id does not match the after snapshot's executionRequestId", async () => {
    const launchJob = fakeLaunchJob();

    await launchAdaMergeControl({
      documentId: "req-2",
      before: run("accepted", { executionRequestId: "req-1" }),
      after: run("ci_succeeded", { executionRequestId: "req-1" }),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("logs only safe identifiers on a successful launch", async () => {
    const launchJob = fakeLaunchJob({ operationName: "projects/p/locations/l/operations/op-9" });
    const logger = fakeLogger();

    await launchAdaMergeControl({
      documentId: "req-1",
      before: run("accepted"),
      after: run("ci_succeeded"),
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        executionRequestId: "req-1",
        eventId: "event-1",
        operationName: "projects/p/locations/l/operations/op-9",
      }),
    );
  });

  it("rethrows a transient launcher failure so the platform retries", async () => {
    const launchJob: LaunchAdaMergeControllerJob = vi.fn().mockRejectedValue(new Error("network blip"));

    await expect(
      launchAdaMergeControl({
        documentId: "req-1",
        before: run("accepted"),
        after: run("ci_succeeded"),
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
    const launchJob: LaunchAdaMergeControllerJob = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { code }));
    const logger = fakeLogger();

    await launchAdaMergeControl({
      documentId: "req-1",
      before: run("accepted"),
      after: run("ci_succeeded"),
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(logger.error).toHaveBeenCalled();
    expect(launchJob).toHaveBeenCalledTimes(1);
  });
});
