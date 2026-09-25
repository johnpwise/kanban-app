import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import {
  ReleaseIntentValidationError,
  deriveReleaseIntentId,
  deriveReleaseVersionFromIntentId,
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

  it("parses a valid document that also carries a durably recorded start result", () => {
    const documentWithStart = {
      ...validDocument,
      start: { releaseBranch: "release/0.2.0", commitSha: "c".repeat(40), recordedAt: Timestamp.fromMillis(0) },
    };
    const parsed = parseReleaseIntentDocument(validDocument.releaseIntentId, documentWithStart);
    expect(parsed).toEqual(documentWithStart);
  });

  it("throws on schema validation failure (malformed start.commitSha)", () => {
    expect(() =>
      parseReleaseIntentDocument(validDocument.releaseIntentId, {
        ...validDocument,
        start: { releaseBranch: "release/0.2.0", commitSha: "short", recordedAt: Timestamp.fromMillis(0) },
      }),
    ).toThrow();
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

describe("deriveReleaseVersionFromIntentId", () => {
  it("decodes the version when the id's repository prefix matches the trusted repository", () => {
    expect(deriveReleaseVersionFromIntentId("johnpwise__kanban-app--0.2.0", "johnpwise/kanban-app")).toBe("0.2.0");
  });

  it("returns undefined when the id's repository prefix does not match the trusted repository", () => {
    expect(deriveReleaseVersionFromIntentId("someone-else__other-repo--0.2.0", "johnpwise/kanban-app")).toBeUndefined();
  });

  it("returns undefined when the remainder after the prefix is not a valid plain version", () => {
    expect(deriveReleaseVersionFromIntentId("johnpwise__kanban-app--v0.2.0", "johnpwise/kanban-app")).toBeUndefined();
  });

  it("returns undefined for an id with no matching prefix at all", () => {
    expect(deriveReleaseVersionFromIntentId("not-a-release-intent-id", "johnpwise/kanban-app")).toBeUndefined();
  });

  it("round-trips through deriveReleaseIntentId", () => {
    const id = deriveReleaseIntentId("johnpwise/kanban-app", "3.4.5");
    expect(deriveReleaseVersionFromIntentId(id, "johnpwise/kanban-app")).toBe("3.4.5");
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
