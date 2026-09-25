import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";

import { isDeliveryEligibleForCiControl } from "./deliveryEligibility";

function runWithoutDelivery(overrides: Record<string, unknown> = {}) {
  return {
    executionRequestId: "req-1",
    status: "accepted",
    ...overrides,
  };
}

function delivery(overrides: Record<string, unknown> = {}) {
  return {
    branch: "ada/req-1",
    commitSha: "a".repeat(40),
    recordedAt: Timestamp.now(),
    ...overrides,
  };
}

function runWithDelivery(overrides: Record<string, unknown> = {}) {
  return runWithoutDelivery({ delivery: delivery(), ...overrides });
}

describe("isDeliveryEligibleForCiControl", () => {
  it("is eligible when delivery transitions from absent to present on a matching document id", () => {
    expect(
      isDeliveryEligibleForCiControl({
        documentId: "req-1",
        before: runWithoutDelivery(),
        after: runWithDelivery(),
      }),
    ).toBe(true);
  });

  it("is not eligible when delivery is absent both before and after", () => {
    expect(
      isDeliveryEligibleForCiControl({
        documentId: "req-1",
        before: runWithoutDelivery(),
        after: runWithoutDelivery(),
      }),
    ).toBe(false);
  });

  it("is not eligible when delivery was already present and an unrelated field changes", () => {
    expect(
      isDeliveryEligibleForCiControl({
        documentId: "req-1",
        before: runWithDelivery(),
        after: runWithDelivery({ status: "ci_succeeded" }),
      }),
    ).toBe(false);
  });

  it("is not eligible when delivery was already present and a later ci write occurs", () => {
    expect(
      isDeliveryEligibleForCiControl({
        documentId: "req-1",
        before: runWithDelivery(),
        after: runWithDelivery({
          ci: {
            commitSha: "a".repeat(40),
            state: "succeeded",
            runId: 1,
            htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/1",
            recordedAt: Timestamp.now(),
          },
        }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document is malformed", () => {
    expect(
      isDeliveryEligibleForCiControl({
        documentId: "req-1",
        before: runWithoutDelivery(),
        after: { executionRequestId: "req-1", delivery: "not-an-object" },
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document is malformed", () => {
    expect(
      isDeliveryEligibleForCiControl({
        documentId: "req-1",
        before: { executionRequestId: "req-1", delivery: "not-an-object" },
        after: runWithDelivery(),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document's executionRequestId does not match the document id", () => {
    expect(
      isDeliveryEligibleForCiControl({
        documentId: "req-2",
        before: runWithoutDelivery({ executionRequestId: "req-1" }),
        after: runWithDelivery({ executionRequestId: "req-1" }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document's executionRequestId does not match the document id", () => {
    expect(
      isDeliveryEligibleForCiControl({
        documentId: "req-2",
        before: runWithoutDelivery({ executionRequestId: "req-1" }),
        after: runWithDelivery({ executionRequestId: "req-2" }),
      }),
    ).toBe(false);
  });

  it("is not eligible when the after document has no data at all (deletion)", () => {
    expect(
      isDeliveryEligibleForCiControl({
        documentId: "req-1",
        before: runWithoutDelivery(),
        after: undefined,
      }),
    ).toBe(false);
  });

  it("is not eligible when the before document has no data at all (document creation)", () => {
    expect(
      isDeliveryEligibleForCiControl({
        documentId: "req-1",
        before: undefined,
        after: runWithDelivery(),
      }),
    ).toBe(false);
  });
});
