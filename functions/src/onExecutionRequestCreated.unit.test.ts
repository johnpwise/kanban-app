import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./dispatchExecutionRequest", () => ({
  dispatchExecutionRequest: vi.fn().mockResolvedValue(undefined),
}));

import { dispatchExecutionRequest } from "./dispatchExecutionRequest";
import { handleExecutionRequestCreated } from "./onExecutionRequestCreated";

import type { FirestoreEvent, QueryDocumentSnapshot } from "firebase-functions/v2/firestore";

const mockedDispatch = vi.mocked(dispatchExecutionRequest);

const defaultRawData = {
  projectId: "project-1",
  cardId: "card-1",
  title: "Ship the demo",
  prompt: "Ship the demo build.",
  repository: "johnpwise/kanban-app",
  baseBranch: "develop",
  requestedBy: "user-1",
  requestedAt: { toDate: () => new Date("2026-09-20T19:00:00.000Z") },
};

function buildEvent({
  executionRequestId = "request-1",
  rawData = defaultRawData,
  hasData = true,
}: { executionRequestId?: string; rawData?: Record<string, unknown>; hasData?: boolean } = {}) {
  return {
    params: { executionRequestId },
    data: hasData ? ({ data: () => rawData } as unknown as QueryDocumentSnapshot) : undefined,
  } as unknown as FirestoreEvent<QueryDocumentSnapshot | undefined, { executionRequestId: string }>;
}

describe("handleExecutionRequestCreated", () => {
  beforeEach(() => {
    mockedDispatch.mockClear();
  });

  it("should dispatch with the trigger's executionRequestId and Timestamp converted to an ISO string", async () => {
    await handleExecutionRequestCreated(buildEvent());

    expect(mockedDispatch).toHaveBeenCalledTimes(1);
    const call = mockedDispatch.mock.calls[0][0];
    expect(call.executionRequestId).toBe("request-1");
    expect(call.data).toMatchObject({
      projectId: "project-1",
      cardId: "card-1",
      requestedAt: "2026-09-20T19:00:00.000Z",
    });
  });

  it("should pass an already-string requestedAt through unchanged", async () => {
    await handleExecutionRequestCreated(
      buildEvent({ rawData: { ...defaultRawData, requestedAt: "2026-09-20T19:00:00.000Z" } }),
    );

    const call = mockedDispatch.mock.calls[0][0];
    expect(call.data).toMatchObject({ requestedAt: "2026-09-20T19:00:00.000Z" });
  });

  it("should handle missing event data safely without dispatching", async () => {
    await handleExecutionRequestCreated(buildEvent({ hasData: false }));

    expect(mockedDispatch).not.toHaveBeenCalled();
  });
});
