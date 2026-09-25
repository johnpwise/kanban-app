import { describe, expect, it } from "vitest";

import { parseReleaseControllerConfig } from "./releaseControllerConfig";

const validEnv = {
  ADA_RELEASE_INTENT_ID: "johnpwise__kanban-app--0.2.0",
  ADA_RELEASE_REPOSITORY: "johnpwise/kanban-app",
  ADA_RELEASE_SOURCE_BRANCH: "develop",
};

describe("parseReleaseControllerConfig", () => {
  it("parses a valid environment", () => {
    const config = parseReleaseControllerConfig(validEnv);
    expect(config).toEqual({
      releaseIntentId: "johnpwise__kanban-app--0.2.0",
      repository: "johnpwise/kanban-app",
      sourceBranch: "develop",
    });
  });

  it.each(["ADA_RELEASE_INTENT_ID", "ADA_RELEASE_REPOSITORY", "ADA_RELEASE_SOURCE_BRANCH"])(
    "throws when %s is missing",
    (key) => {
      const env = { ...validEnv, [key]: undefined };
      expect(() => parseReleaseControllerConfig(env)).toThrow();
    },
  );

  it.each(["ADA_RELEASE_INTENT_ID", "ADA_RELEASE_REPOSITORY", "ADA_RELEASE_SOURCE_BRANCH"])(
    "throws when %s is blank",
    (key) => {
      const env = { ...validEnv, [key]: "   " };
      expect(() => parseReleaseControllerConfig(env)).toThrow();
    },
  );

  it("throws when ADA_RELEASE_INTENT_ID is not a valid Firestore document id (contains a slash)", () => {
    const env = { ...validEnv, ADA_RELEASE_INTENT_ID: "johnpwise/kanban-app--0.2.0" };
    expect(() => parseReleaseControllerConfig(env)).toThrow();
  });

  it("throws when ADA_RELEASE_REPOSITORY is not owner/repo", () => {
    const env = { ...validEnv, ADA_RELEASE_REPOSITORY: "not-a-repository" };
    expect(() => parseReleaseControllerConfig(env)).toThrow();
  });
});
