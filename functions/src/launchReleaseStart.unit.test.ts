import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { launchReleaseStart } from "./launchReleaseStart";

import type { LaunchAdaReleaseControllerJob, LaunchAdaReleaseControllerJobResult } from "./launchReleaseStart";

const TRUSTED_REPOSITORY = "johnpwise/kanban-app";

function fakeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function validRequestDocument(overrides: Record<string, unknown> = {}) {
  return {
    releaseRequestId: "release-request-1",
    version: "0.2.0",
    requestedBy: "user-1",
    requestedAt: Timestamp.now(),
    ...overrides,
  };
}

function fakeLaunchJob(
  result: LaunchAdaReleaseControllerJobResult = { operationName: "op-1" },
): LaunchAdaReleaseControllerJob {
  return vi.fn().mockResolvedValue(result);
}

describe("launchReleaseStart", () => {
  it("requests exactly one launch with the deterministic releaseIntentId derived from the trusted repository and the request's version", async () => {
    const launchJob = fakeLaunchJob();

    await launchReleaseStart({
      documentId: "release-request-1",
      data: validRequestDocument(),
      eventId: "event-1",
      trustedRepository: TRUSTED_REPOSITORY,
      launchJob,
      logger: fakeLogger(),
    });

    expect(launchJob).toHaveBeenCalledTimes(1);
    expect(launchJob).toHaveBeenCalledWith({ releaseIntentId: "johnpwise__kanban-app--0.2.0" });
  });

  it("acknowledges without launching when the event carried no document data", async () => {
    const launchJob = fakeLaunchJob();
    const logger = fakeLogger();

    await launchReleaseStart({
      documentId: "release-request-1",
      data: undefined,
      eventId: "event-1",
      trustedRepository: TRUSTED_REPOSITORY,
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("acknowledges without launching a malformed release request document", async () => {
    const launchJob = fakeLaunchJob();
    const logger = fakeLogger();

    await launchReleaseStart({
      documentId: "release-request-1",
      data: { releaseRequestId: "release-request-1" },
      eventId: "event-1",
      trustedRepository: TRUSTED_REPOSITORY,
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("acknowledges without launching when the document id does not match its releaseRequestId field", async () => {
    const launchJob = fakeLaunchJob();
    const logger = fakeLogger();

    await launchReleaseStart({
      documentId: "release-request-2",
      data: validRequestDocument({ releaseRequestId: "release-request-1" }),
      eventId: "event-1",
      trustedRepository: TRUSTED_REPOSITORY,
      launchJob,
      logger,
    });

    expect(launchJob).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it("logs only safe identifiers and the operation identity on a successful launch", async () => {
    const launchJob = fakeLaunchJob({ operationName: "projects/p/locations/l/operations/op-9" });
    const logger = fakeLogger();

    await launchReleaseStart({
      documentId: "release-request-1",
      data: validRequestDocument(),
      eventId: "event-1",
      trustedRepository: TRUSTED_REPOSITORY,
      launchJob,
      logger,
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        releaseRequestId: "release-request-1",
        releaseIntentId: "johnpwise__kanban-app--0.2.0",
        eventId: "event-1",
        operationName: "projects/p/locations/l/operations/op-9",
      }),
    );
  });

  it("rethrows a transient launcher failure so the platform retries", async () => {
    const launchJob: LaunchAdaReleaseControllerJob = vi.fn().mockRejectedValue(new Error("network blip"));

    await expect(
      launchReleaseStart({
        documentId: "release-request-1",
        data: validRequestDocument(),
        eventId: "event-1",
        trustedRepository: TRUSTED_REPOSITORY,
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
    const launchJob: LaunchAdaReleaseControllerJob = vi.fn().mockRejectedValue(Object.assign(new Error("boom"), { code }));
    const logger = fakeLogger();

    await launchReleaseStart({
      documentId: "release-request-1",
      data: validRequestDocument(),
      eventId: "event-1",
      trustedRepository: TRUSTED_REPOSITORY,
      launchJob,
      logger,
    });

    expect(logger.error).toHaveBeenCalled();
  });
});
