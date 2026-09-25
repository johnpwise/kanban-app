import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { isCiSucceededEligibleForMergeControl } from "./mergeCompletionEligibility";

function run(status: string, overrides: Record<string, unknown> = {}) {
  return {
    executionRequestId: "req-1",
    status,
    ...overrides,
  };
}

describe("isCiSucceededEligibleForMergeControl", () => {
  it("is eligible when status transitions from accepted to ci_succeeded on a matching document id", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-1",
        before: run("accepted"),
        after: run("ci_succeeded"),
      }),
    ).toBe(true);
  });

  it("is not eligible when status is already ci_succeeded before and after (non-transitioning snapshot)", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-1",
        before: run("ci_succeeded"),
        after: run("ci_succeeded", { merge: { deliveryCommitSha: "a".repeat(40) } }),
      }),
    ).toBe(false);
  });

  it("is not eligible when status transitions from accepted to ci_failed", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-1",
        before: run("accepted"),
        after: run("ci_failed"),
      }),
    ).toBe(false);
  });

  it("is not eligible when status transitions from ci_succeeded to merged", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-1",
        before: run("ci_succeeded"),
        after: run("merged"),
      }),
    ).toBe(false);
  });

  it("is not eligible when status is ci_failed both before and after", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-1",
        before: run("ci_failed"),
        after: run("ci_failed"),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document is malformed", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-1",
        before: run("accepted"),
        after: { executionRequestId: "req-1", status: 42 },
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document is malformed", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-1",
        before: { executionRequestId: "req-1", status: 42 },
        after: run("ci_succeeded"),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document's executionRequestId does not match the document id", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-2",
        before: run("accepted", { executionRequestId: "req-1" }),
        after: run("ci_succeeded", { executionRequestId: "req-1" }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document's executionRequestId does not match the document id", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-2",
        before: run("accepted", { executionRequestId: "req-1" }),
        after: run("ci_succeeded", { executionRequestId: "req-2" }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document has no data at all (deletion)", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-1",
        before: run("accepted"),
        after: undefined,
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document has no data at all (document creation)", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-1",
        before: undefined,
        after: run("ci_succeeded"),
      }),
    ).toBe(false);
  });

  it("uses Timestamp-bearing fields without affecting eligibility (schema is passthrough beyond status)", () => {
    expect(
      isCiSucceededEligibleForMergeControl({
        documentId: "req-1",
        before: run("accepted", { acceptedAt: Timestamp.now() }),
        after: run("ci_succeeded", { acceptedAt: Timestamp.now() }),
      }),
    ).toBe(true);
  });
});
