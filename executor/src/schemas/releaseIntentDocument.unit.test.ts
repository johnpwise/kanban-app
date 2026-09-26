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

  it("parses a valid document that also carries durably recorded release pull request results for both targets", () => {
    const documentWithPullRequests = {
      ...validDocument,
      pullRequests: {
        main: { number: 101, baseBranch: "main", headBranch: "release/0.2.0", headSha: "c".repeat(40), recordedAt: Timestamp.fromMillis(0) },
        develop: { number: 102, baseBranch: "develop", headBranch: "release/0.2.0", headSha: "c".repeat(40), recordedAt: Timestamp.fromMillis(0) },
      },
    };
    const parsed = parseReleaseIntentDocument(validDocument.releaseIntentId, documentWithPullRequests);
    expect(parsed).toEqual(documentWithPullRequests);
  });

  it("parses a valid document with only one release pull request target recorded", () => {
    const documentWithOnePullRequest = {
      ...validDocument,
      pullRequests: {
        main: { number: 101, baseBranch: "main", headBranch: "release/0.2.0", headSha: "c".repeat(40), recordedAt: Timestamp.fromMillis(0) },
      },
    };
    const parsed = parseReleaseIntentDocument(validDocument.releaseIntentId, documentWithOnePullRequest);
    expect(parsed).toEqual(documentWithOnePullRequest);
  });

  it("throws on schema validation failure (malformed pullRequests.main.headSha)", () => {
    expect(() =>
      parseReleaseIntentDocument(validDocument.releaseIntentId, {
        ...validDocument,
        pullRequests: {
          main: { number: 101, baseBranch: "main", headBranch: "release/0.2.0", headSha: "short", recordedAt: Timestamp.fromMillis(0) },
        },
      }),
    ).toThrow();
  });

  it("parses a valid document that also carries durably recorded terminal CI evidence for both targets", () => {
    const documentWithCi = {
      ...validDocument,
      ci: {
        main: {
          number: 101,
          baseBranch: "main",
          headBranch: "release/0.2.0",
          headSha: "c".repeat(40),
          state: "succeeded",
          runId: 501,
          htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/501",
          recordedAt: Timestamp.fromMillis(0),
        },
        develop: {
          number: 102,
          baseBranch: "develop",
          headBranch: "release/0.2.0",
          headSha: "c".repeat(40),
          state: "failed",
          runId: 502,
          htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/502",
          conclusion: "failure",
          recordedAt: Timestamp.fromMillis(0),
        },
      },
    };
    const parsed = parseReleaseIntentDocument(validDocument.releaseIntentId, documentWithCi);
    expect(parsed).toEqual(documentWithCi);
  });

  it("parses a valid document with only one target's terminal CI evidence recorded", () => {
    const documentWithOneCiResult = {
      ...validDocument,
      ci: {
        main: {
          number: 101,
          baseBranch: "main",
          headBranch: "release/0.2.0",
          headSha: "c".repeat(40),
          state: "succeeded",
          runId: 501,
          htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/501",
          recordedAt: Timestamp.fromMillis(0),
        },
      },
    };
    const parsed = parseReleaseIntentDocument(validDocument.releaseIntentId, documentWithOneCiResult);
    expect(parsed).toEqual(documentWithOneCiResult);
  });

  it("throws on schema validation failure (ci.main.state not succeeded/failed)", () => {
    expect(() =>
      parseReleaseIntentDocument(validDocument.releaseIntentId, {
        ...validDocument,
        ci: {
          main: {
            number: 101,
            baseBranch: "main",
            headBranch: "release/0.2.0",
            headSha: "c".repeat(40),
            state: "pending",
            runId: 501,
            htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/501",
            recordedAt: Timestamp.fromMillis(0),
          },
        },
      }),
    ).toThrow();
  });

  it("throws on schema validation failure (malformed ci.main.headSha)", () => {
    expect(() =>
      parseReleaseIntentDocument(validDocument.releaseIntentId, {
        ...validDocument,
        ci: {
          main: {
            number: 101,
            baseBranch: "main",
            headBranch: "release/0.2.0",
            headSha: "short",
            state: "succeeded",
            runId: 501,
            htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/501",
            recordedAt: Timestamp.fromMillis(0),
          },
        },
      }),
    ).toThrow();
  });

  it("parses a valid document that also carries durably recorded merge evidence for both targets", () => {
    const documentWithMerges = {
      ...validDocument,
      merges: {
        main: {
          number: 101,
          baseBranch: "main",
          headBranch: "release/0.2.0",
          headSha: "c".repeat(40),
          mergeCommitSha: "d".repeat(40),
          recordedAt: Timestamp.fromMillis(0),
        },
        develop: {
          number: 102,
          baseBranch: "develop",
          headBranch: "release/0.2.0",
          headSha: "c".repeat(40),
          mergeCommitSha: "e".repeat(40),
          recordedAt: Timestamp.fromMillis(0),
        },
      },
    };
    const parsed = parseReleaseIntentDocument(validDocument.releaseIntentId, documentWithMerges);
    expect(parsed).toEqual(documentWithMerges);
  });

  it("parses a valid document with only one target's merge evidence recorded", () => {
    const documentWithOneMerge = {
      ...validDocument,
      merges: {
        main: {
          number: 101,
          baseBranch: "main",
          headBranch: "release/0.2.0",
          headSha: "c".repeat(40),
          mergeCommitSha: "d".repeat(40),
          recordedAt: Timestamp.fromMillis(0),
        },
      },
    };
    const parsed = parseReleaseIntentDocument(validDocument.releaseIntentId, documentWithOneMerge);
    expect(parsed).toEqual(documentWithOneMerge);
  });

  it("throws on schema validation failure (malformed merges.main.mergeCommitSha)", () => {
    expect(() =>
      parseReleaseIntentDocument(validDocument.releaseIntentId, {
        ...validDocument,
        merges: {
          main: {
            number: 101,
            baseBranch: "main",
            headBranch: "release/0.2.0",
            headSha: "c".repeat(40),
            mergeCommitSha: "short",
            recordedAt: Timestamp.fromMillis(0),
          },
        },
      }),
    ).toThrow();
  });

  it("throws on schema validation failure (malformed merges.main.headSha)", () => {
    expect(() =>
      parseReleaseIntentDocument(validDocument.releaseIntentId, {
        ...validDocument,
        merges: {
          main: {
            number: 101,
            baseBranch: "main",
            headBranch: "release/0.2.0",
            headSha: "short",
            mergeCommitSha: "d".repeat(40),
            recordedAt: Timestamp.fromMillis(0),
          },
        },
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
