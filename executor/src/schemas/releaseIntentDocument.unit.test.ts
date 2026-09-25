import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import {
  ReleaseIntentValidationError,
  deriveReleaseIntentId,
  isReleaseVersionGreaterThan,
  parseReleaseIntentDocument,
  releaseVersionSchema,
} from "./releaseIntentDocument";

const validDocument = {
  releaseIntentId: "johnpwise__kanban-app--0.2.0",
  repository: "johnpwise/kanban-app",
  version: "0.2.0",
  sourceBranch: "develop",
  sourceRevision: "18cc88e1db1c0c0e1310e3b399d0f7bda00894a4",
  requestedAt: Timestamp.fromMillis(0),
};

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

describe("parseReleaseIntentDocument", () => {
  it("parses a valid document whose id matches its releaseIntentId field", () => {
    const parsed = parseReleaseIntentDocument(validDocument.releaseIntentId, validDocument);
    expect(parsed).toEqual(validDocument);
  });

  it("throws ReleaseIntentValidationError when the document id does not match releaseIntentId", () => {
    expect(() => parseReleaseIntentDocument("some-other-id", validDocument)).toThrow(ReleaseIntentValidationError);
  });

  it("throws on schema validation failure (malformed version)", () => {
    expect(() => parseReleaseIntentDocument(validDocument.releaseIntentId, { ...validDocument, version: "v0.2.0" })).toThrow();
  });

  it("throws on schema validation failure (malformed source revision)", () => {
    expect(() =>
      parseReleaseIntentDocument(validDocument.releaseIntentId, { ...validDocument, sourceRevision: "short" }),
    ).toThrow();
  });
});

describe("deriveReleaseIntentId", () => {
  it("joins repository and version with owner/repo's slash replaced", () => {
    expect(deriveReleaseIntentId("johnpwise/kanban-app", "0.2.0")).toBe("johnpwise__kanban-app--0.2.0");
  });
});

describe("isReleaseVersionGreaterThan", () => {
  it.each([
    ["0.2.0", "0.1.0", true],
    ["1.0.0", "0.9.9", true],
    ["0.1.1", "0.1.0", true],
    ["0.1.0", "0.1.0", false],
    ["0.1.0", "0.2.0", false],
    ["0.9.0", "0.10.0", false],
  ])("isReleaseVersionGreaterThan(%s, %s) === %s", (candidate, current, expected) => {
    expect(isReleaseVersionGreaterThan(candidate, current)).toBe(expected);
  });
});
