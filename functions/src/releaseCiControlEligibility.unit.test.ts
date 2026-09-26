import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { isReleasePullRequestRecordedEligibleForCiControl } from "./releaseCiControlEligibility";

function intent(overrides: Record<string, unknown> = {}) {
  return {
    releaseIntentId: "intent-1",
    ...overrides,
  };
}

function pullRequestResult(overrides: Record<string, unknown> = {}) {
  return {
    number: 64,
    baseBranch: "main",
    headBranch: "release/0.1.1",
    headSha: "a".repeat(40),
    recordedAt: Timestamp.now(),
    ...overrides,
  };
}

describe("isReleasePullRequestRecordedEligibleForCiControl", () => {
  it.each(["main", "develop"] as const)(
    "is eligible when pullRequests.%s transitions from absent to present on a matching document id",
    (target) => {
      expect(
        isReleasePullRequestRecordedEligibleForCiControl({
          documentId: "intent-1",
          target,
          before: intent(),
          after: intent({ pullRequests: { [target]: pullRequestResult() } }),
        }),
      ).toBe(true);
    },
  );

  it("is eligible for develop when main was already present before and after (independent targets)", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-1",
        target: "develop",
        before: intent({ pullRequests: { main: pullRequestResult() } }),
        after: intent({ pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) } }),
      }),
    ).toBe(true);
  });

  it("is not eligible when the target is absent both before and after", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-1",
        target: "main",
        before: intent(),
        after: intent(),
      }),
    ).toBe(false);
  });

  it("is not eligible when the target was already present before the update (not a new transition)", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-1",
        target: "main",
        before: intent({ pullRequests: { main: pullRequestResult() } }),
        after: intent({ pullRequests: { main: pullRequestResult() } }),
      }),
    ).toBe(false);
  });

  it("is not eligible for a later ci-persistence update on an already-recorded target", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-1",
        target: "main",
        before: intent({ pullRequests: { main: pullRequestResult() } }),
        after: intent({
          pullRequests: { main: pullRequestResult() },
          ci: { main: { ...pullRequestResult(), state: "succeeded", runId: 1, htmlUrl: "https://x" } },
        }),
      }),
    ).toBe(false);
  });

  it("is not eligible when only the other target transitions", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-1",
        target: "main",
        before: intent(),
        after: intent({ pullRequests: { develop: pullRequestResult({ baseBranch: "develop" }) } }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document is malformed", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-1",
        target: "main",
        before: intent(),
        after: { releaseIntentId: "intent-1", pullRequests: "not-an-object" },
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document is malformed", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-1",
        target: "main",
        before: { releaseIntentId: "intent-1", pullRequests: 42 },
        after: intent({ pullRequests: { main: pullRequestResult() } }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document's releaseIntentId does not match the document id", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-2",
        target: "main",
        before: intent({ releaseIntentId: "intent-1" }),
        after: intent({ releaseIntentId: "intent-1", pullRequests: { main: pullRequestResult() } }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document's releaseIntentId does not match the document id", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-2",
        target: "main",
        before: intent({ releaseIntentId: "intent-1" }),
        after: intent({ releaseIntentId: "intent-2", pullRequests: { main: pullRequestResult() } }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document has no data at all (deletion)", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-1",
        target: "main",
        before: intent(),
        after: undefined,
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document has no data at all (document creation)", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-1",
        target: "main",
        before: undefined,
        after: intent({ pullRequests: { main: pullRequestResult() } }),
      }),
    ).toBe(false);
  });

  it("is not eligible for an unrelated field-only update with the target absent throughout", () => {
    expect(
      isReleasePullRequestRecordedEligibleForCiControl({
        documentId: "intent-1",
        target: "main",
        before: intent({ requestedAt: Timestamp.now() }),
        after: intent({ requestedAt: Timestamp.now() }),
      }),
    ).toBe(false);
  });
});
