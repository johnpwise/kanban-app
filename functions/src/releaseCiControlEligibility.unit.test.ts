import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { isReleasePullRequestPairCompletionEligibleForCiControl } from "./releaseCiControlEligibility";

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

describe("isReleasePullRequestPairCompletionEligibleForCiControl", () => {
  it("is eligible when main is recorded first and develop completes the pair", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent({ pullRequests: { main: pullRequestResult() } }),
        after: intent({
          pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) },
        }),
      }),
    ).toBe(true);
  });

  it("is eligible when develop is recorded first and main completes the pair", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent({ pullRequests: { develop: pullRequestResult({ baseBranch: "develop" }) } }),
        after: intent({
          pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) },
        }),
      }),
    ).toBe(true);
  });

  it("is eligible when both PR identities are recorded together in one update", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent(),
        after: intent({
          pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) },
        }),
      }),
    ).toBe(true);
  });

  it("is not eligible when only main is present after the update", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent(),
        after: intent({ pullRequests: { main: pullRequestResult() } }),
      }),
    ).toBe(false);
  });

  it("is not eligible when only develop is present after the update", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent(),
        after: intent({ pullRequests: { develop: pullRequestResult({ baseBranch: "develop" }) } }),
      }),
    ).toBe(false);
  });

  it("is not eligible when neither target is present after the update", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent(),
        after: intent(),
      }),
    ).toBe(false);
  });

  it("is not eligible when both targets were already present before the update (not a new transition)", () => {
    const bothPresent = {
      pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) },
    };
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent(bothPresent),
        after: intent(bothPresent),
      }),
    ).toBe(false);
  });

  it("is not eligible for a later ci.main write on an already-complete pair", () => {
    const bothPresent = {
      pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) },
    };
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent(bothPresent),
        after: intent({
          ...bothPresent,
          ci: { main: { ...pullRequestResult(), state: "succeeded", runId: 1, htmlUrl: "https://x" } },
        }),
      }),
    ).toBe(false);
  });

  it("is not eligible for a later ci.develop write on an already-complete pair", () => {
    const bothPresent = {
      pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) },
    };
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent(bothPresent),
        after: intent({
          ...bothPresent,
          ci: { develop: { ...pullRequestResult(), state: "succeeded", runId: 2, htmlUrl: "https://x" } },
        }),
      }),
    ).toBe(false);
  });

  it("is not eligible for an unrelated field-only update while both targets remain absent", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent({ requestedAt: Timestamp.now() }),
        after: intent({ requestedAt: Timestamp.now() }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document is malformed", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent({ pullRequests: { main: pullRequestResult() } }),
        after: { releaseIntentId: "intent-1", pullRequests: "not-an-object" },
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document is malformed", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: { releaseIntentId: "intent-1", pullRequests: 42 },
        after: intent({
          pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) },
        }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document's releaseIntentId does not match the document id", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-2",
        before: intent({ releaseIntentId: "intent-1", pullRequests: { main: pullRequestResult() } }),
        after: intent({
          releaseIntentId: "intent-1",
          pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) },
        }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document's releaseIntentId does not match the document id", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-2",
        before: intent({ releaseIntentId: "intent-1", pullRequests: { main: pullRequestResult() } }),
        after: intent({
          releaseIntentId: "intent-2",
          pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) },
        }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document has no data at all (deletion)", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: intent({ pullRequests: { main: pullRequestResult() } }),
        after: undefined,
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document has no data at all (document creation)", () => {
    expect(
      isReleasePullRequestPairCompletionEligibleForCiControl({
        documentId: "intent-1",
        before: undefined,
        after: intent({
          pullRequests: { main: pullRequestResult(), develop: pullRequestResult({ baseBranch: "develop" }) },
        }),
      }),
    ).toBe(false);
  });
});
