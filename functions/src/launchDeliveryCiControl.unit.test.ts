import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { launchDeliveryCiControl } from "./launchDeliveryCiControl";

import type { LaunchAdaCiControllerJob, LaunchAdaCiControllerJobResult } from "./launchDeliveryCiControl";

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function runWithoutDelivery(overrides: Record<string, unknown> = {}) {
  return {
    executionRequestId: "req-1",
    status: "accepted",
    ...overrides,
  };
}

function runWithDelivery(overrides: Record<string, unknown> = {}) {
  return runWithoutDelivery({
    delivery: { branch: "ada/req-1", commitSha: "a".repeat(40), recordedAt: Timestamp.now() },
    ...overrides,
  });
}

function fakeLaunchJob(result: LaunchAdaCiControllerJobResult = { operationName: "op-1" }): LaunchAdaCiControllerJob {
  return vi.fn().mockResolvedValue(result);
}

describe("launchDeliveryCiControl", () => {
  it("requests exactly one CI-controller launch for a delivery absent-to-present transition", async () => {
    const launchJob = fakeLaunchJob();

    await launchDeliveryCiControl({
      documentId: "req-1",
      before: runWithoutDelivery(),
      after: runWithDelivery(),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ executionRequestId: "req-1" });
  });

  it("does not launch when delivery is absent both before and after", async () => {
    const launchJob = fakeLaunchJob();

    await launchDeliveryCiControl({
      documentId: "req-1",
      before: runWithoutDelivery(),
      after: runWithoutDelivery(),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("does not launch a second time when a later ci write updates an already-delivered run", async () => {
    const launchJob = fakeLaunchJob();

    await launchDeliveryCiControl({
      documentId: "req-1",
      before: runWithDelivery(),
      after: runWithDelivery({
        ci: {
          commitSha: "a".repeat(40),
          state: "succeeded",
          runId: 1,
          htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/1",
          recordedAt: Timestamp.now(),
        },
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

    await launchDeliveryCiControl({
      documentId: "req-1",
      before: runWithoutDelivery(),
      after: { executionRequestId: "req-1", delivery: "not-an-object" },
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

    await launchDeliveryCiControl({
      documentId: "req-2",
      before: runWithoutDelivery({ executionRequestId: "req-1" }),
      after: runWithDelivery({ executionRequestId: "req-1" }),
      eventId: "event-1",
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).not.toHaveBeenCalled();
  });

  it("logs only safe identifiers on a successful launch", async () => {
    const launchJob = fakeLaunchJob({ operationName: "projects/p/locations/l/operations/op-9" });
    const logger = fakeLogger();

    await launchDeliveryCiControl({
      documentId: "req-1",
      before: runWithoutDelivery(),
      after: runWithDelivery(),
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
    const launchJob: LaunchAdaCiControllerJob = vi.fn().mockRejectedValue(new Error("network blip"));

    await expect(
      launchDeliveryCiControl({
        documentId: "req-1",
        before: runWithoutDelivery(),
        after: runWithDelivery(),
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
    const launchJob: LaunchAdaCiControllerJob = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { code }));
    const logger = fakeLogger();

    await launchDeliveryCiControl({
      documentId: "req-1",
      before: runWithoutDelivery(),
      after: runWithDelivery(),
      eventId: "event-1",
      launchJob,
      logger,
    });

    expect(logger.error).toHaveBeenCalled();
    expect(launchJob).toHaveBeenCalledTimes(1);
  });
});
