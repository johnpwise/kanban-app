import { beforeEach, describe, expect, it, vi } from "vitest";

import { getCurrentUser } from "@/lib/services/session";

import { startReleaseAction } from "./startRelease";

vi.mock("@/lib/services/session", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/services/release", () => ({ requestRelease: vi.fn() }));

const { requestRelease } = await import("@/lib/services/release");

const requestReleaseMock = vi.mocked(requestRelease);
const getCurrentUserMock = vi.mocked(getCurrentUser);

describe("startReleaseAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({ uid: "user-1", email: "person@example.com" });
    requestReleaseMock.mockResolvedValue({ releaseRequestId: "release-request-1" });
  });

  it("rejects an unauthenticated request without calling requestRelease", async () => {
    // Arrange
    getCurrentUserMock.mockResolvedValue(null);

    // Act
    const result = await startReleaseAction({ status: "idle" }, "0.2.0");

    // Assert
    expect(result.status).toBe("error");
    expect(requestReleaseMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid version without calling requestRelease", async () => {
    // Act
    const result = await startReleaseAction({ status: "idle" }, "v0.2.0");

    // Assert
    expect(result.status).toBe("error");
    expect(requestReleaseMock).not.toHaveBeenCalled();
  });

  it("calls requestRelease with the verified session uid as requestedBy, never a client value", async () => {
    // Act
    await startReleaseAction({ status: "idle" }, "0.2.0");

    // Assert
    expect(requestReleaseMock).toHaveBeenCalledWith({ version: "0.2.0", requestedBy: "user-1" });
  });

  it("returns success on a durably recorded release request", async () => {
    // Act
    const result = await startReleaseAction({ status: "idle" }, "0.2.0");

    // Assert
    expect(result).toEqual({ status: "success" });
  });

  it("maps an unexpected failure to a generic safe message and logs it server-side", async () => {
    // Arrange
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    requestReleaseMock.mockRejectedValue(new Error("firestore is unreachable"));

    // Act
    const result = await startReleaseAction({ status: "idle" }, "0.2.0");

    // Assert
    expect(result).toEqual({ status: "error", message: "Could not start the release. Please try again." });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
