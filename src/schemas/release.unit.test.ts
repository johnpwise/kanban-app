import { describe, expect, it } from "vitest";

import { releaseVersionSchema, requestReleaseInputSchema } from "./release";

describe("releaseVersionSchema", () => {
  it.each(["0.2.0", "1.0.0", "12.34.56"])("accepts plain MAJOR.MINOR.PATCH %s", (version) => {
    expect(releaseVersionSchema.safeParse(version).success).toBe(true);
  });

  it.each([
    ["v0.2.0", "leading v"],
    ["0.2.0-rc.1", "prerelease suffix"],
    ["0.2.0+build.5", "build metadata"],
    ["0.2", "missing patch"],
    ["not-a-version", "non-numeric"],
    ["", "empty"],
  ])("rejects %s (%s)", (version) => {
    expect(releaseVersionSchema.safeParse(version).success).toBe(false);
  });
});

describe("requestReleaseInputSchema", () => {
  it("accepts a valid release request input", () => {
    const result = requestReleaseInputSchema.safeParse({ version: "0.2.0", requestedBy: "user-1" });
    expect(result.success).toBe(true);
  });

  it("rejects a blank requestedBy", () => {
    const result = requestReleaseInputSchema.safeParse({ version: "0.2.0", requestedBy: "" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid version", () => {
    const result = requestReleaseInputSchema.safeParse({ version: "v0.2.0", requestedBy: "user-1" });
    expect(result.success).toBe(false);
  });
});
