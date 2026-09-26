import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { isReleaseStartCompletionEligibleForPullRequestControl } from "./releasePullRequestCompletionEligibility";

function intent(overrides: Record<string, unknown> = {}) {
  return {
    releaseIntentId: "intent-1",
    ...overrides,
  };
}

function startResult(overrides: Record<string, unknown> = {}) {
  return {
    releaseBranch: "release/0.2.0",
    commitSha: "a".repeat(40),
    recordedAt: Timestamp.now(),
    ...overrides,
  };
}

describe("isReleaseStartCompletionEligibleForPullRequestControl", () => {
  it("is eligible when start transitions from absent to present on a matching document id", () => {
    expect(
      isReleaseStartCompletionEligibleForPullRequestControl({
        documentId: "intent-1",
        before: intent(),
        after: intent({ start: startResult() }),
      }),
    ).toBe(true);
  });

  it("is not eligible when start is absent both before and after", () => {
    expect(
      isReleaseStartCompletionEligibleForPullRequestControl({
        documentId: "intent-1",
        before: intent(),
        after: intent(),
      }),
    ).toBe(false);
  });

  it("is not eligible when start was already present before the update (not a new transition)", () => {
    expect(
      isReleaseStartCompletionEligibleForPullRequestControl({
        documentId: "intent-1",
        before: intent({ start: startResult() }),
        after: intent({ start: startResult() }),
      }),
    ).toBe(false);
  });

  it("is not eligible for a later pullRequests-persistence update on an already-started intent", () => {
    expect(
      isReleaseStartCompletionEligibleForPullRequestControl({
        documentId: "intent-1",
        before: intent({ start: startResult() }),
        after: intent({
          start: startResult(),
          pullRequests: { main: { number: 1, baseBranch: "main", headBranch: "release/0.2.0", headSha: "a".repeat(40), recordedAt: Timestamp.now() } },
        }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document is malformed", () => {
    expect(
      isReleaseStartCompletionEligibleForPullRequestControl({
        documentId: "intent-1",
        before: intent(),
        after: { releaseIntentId: "intent-1", start: "not-an-object" },
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document is malformed", () => {
    expect(
      isReleaseStartCompletionEligibleForPullRequestControl({
        documentId: "intent-1",
        before: { releaseIntentId: "intent-1", start: 42 },
        after: intent({ start: startResult() }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document's releaseIntentId does not match the document id", () => {
    expect(
      isReleaseStartCompletionEligibleForPullRequestControl({
        documentId: "intent-2",
        before: intent({ releaseIntentId: "intent-1" }),
        after: intent({ releaseIntentId: "intent-1", start: startResult() }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document's releaseIntentId does not match the document id", () => {
    expect(
      isReleaseStartCompletionEligibleForPullRequestControl({
        documentId: "intent-2",
        before: intent({ releaseIntentId: "intent-1" }),
        after: intent({ releaseIntentId: "intent-2", start: startResult() }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document has no data at all (deletion)", () => {
    expect(
      isReleaseStartCompletionEligibleForPullRequestControl({
        documentId: "intent-1",
        before: intent(),
        after: undefined,
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document has no data at all (document creation)", () => {
    expect(
      isReleaseStartCompletionEligibleForPullRequestControl({
        documentId: "intent-1",
        before: undefined,
        after: intent({ start: startResult() }),
      }),
    ).toBe(false);
  });

  it("is not eligible for an unrelated field-only update with start absent throughout", () => {
    expect(
      isReleaseStartCompletionEligibleForPullRequestControl({
        documentId: "intent-1",
        before: intent({ requestedAt: Timestamp.now() }),
        after: intent({ requestedAt: Timestamp.now() }),
      }),
    ).toBe(false);
  });
});
