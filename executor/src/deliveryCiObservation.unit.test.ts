import { describe, expect, it } from "vitest";

import { observeDeliveryCiStatus } from "./deliveryCiObservation";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";

const REPOSITORY = "johnpwise/kanban-app";
const DELIVERY_COMMIT_SHA = "a".repeat(40);
const OTHER_COMMIT_SHA = "b".repeat(40);

const BASE_REQUEST = {
  repository: REPOSITORY,
  deliveryCommitSha: DELIVERY_COMMIT_SHA,
};

const okMintCredential: MintGithubDeliveryCredential = async () => ({
  ok: true,
  token: "minted-installation-token",
  expiresAt: "2026-09-23T13:00:00Z",
});

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function fakeFetch(responder: (call: RecordedCall, callIndex: number) => Response | Promise<never>) {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return responder(call, calls.length - 1);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

function workflowRun(overrides: Partial<{
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
}> = {}) {
  return {
    id: 1,
    head_sha: DELIVERY_COMMIT_SHA,
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/johnpwise/kanban-app/actions/runs/1",
    created_at: "2026-09-23T10:00:00Z",
    ...overrides,
  };
}

describe("observeDeliveryCiStatus", () => {
  it("should return pending when no workflow run matches the delivery commit", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ workflow_runs: [] }, 200));

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(
      "https://api.github.com/repos/johnpwise/kanban-app/actions/workflows/ci.yml/runs",
    );
    expect(url.searchParams.get("head_sha")).toBe(DELIVERY_COMMIT_SHA);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer minted-installation-token");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("should return pending when the matching run is queued", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ status: "queued", conclusion: null })] }, 200),
    );

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
  });

  it("should return pending when the matching run is in_progress", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ status: "in_progress", conclusion: null })] }, 200),
    );

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
  });

  it("should return succeeded when the matching run completed with conclusion success", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ id: 501, status: "completed", conclusion: "success" })] }, 200),
    );

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({
      ok: true,
      state: "succeeded",
      runId: 501,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/1",
    });
  });

  it("should return failed when the matching run completed with conclusion failure", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ id: 502, status: "completed", conclusion: "failure" })] }, 200),
    );

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({
      ok: true,
      state: "failed",
      runId: 502,
      htmlUrl: "https://github.com/johnpwise/kanban-app/actions/runs/1",
      conclusion: "failure",
    });
  });

  it.each(["cancelled", "timed_out", "action_required", "neutral", "stale", "skipped"])(
    "should return failed for the non-success terminal conclusion %s",
    async (conclusion) => {
      // Arrange
      const { fetchImpl } = fakeFetch(() =>
        jsonResponse({ workflow_runs: [workflowRun({ status: "completed", conclusion })] }, 200),
      );

      // Act
      const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

      // Assert
      expect(result.ok).toBe(true);
      expect(result).toMatchObject({ state: "failed", conclusion });
    },
  );

  it("should return failed, never pending or succeeded, when a completed run has a null conclusion", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ status: "completed", conclusion: null })] }, 200),
    );

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ ok: true, state: "failed" });
  });

  it("should never trust a run belonging to a different commit, even if the provider returns one", async () => {
    // Arrange — simulates the provider ignoring the head_sha filter; the wrong-commit run must be
    // filtered out defensively rather than trusted for classification.
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(
        { workflow_runs: [workflowRun({ id: 1, head_sha: OTHER_COMMIT_SHA, status: "completed", conclusion: "failure" })] },
        200,
      ),
    );

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
  });

  it("should resolve multiple matching runs deterministically by most recent created_at, ignoring array order", async () => {
    // Arrange — older run appears first in the array but is completed+failure; the true most-recent
    // run (later created_at) is completed+success and must be authoritative.
    const older = workflowRun({ id: 10, status: "completed", conclusion: "failure", created_at: "2026-09-23T09:00:00Z" });
    const newer = workflowRun({ id: 20, status: "completed", conclusion: "success", created_at: "2026-09-23T10:00:00Z" });
    const { fetchImpl } = fakeFetch(() => jsonResponse({ workflow_runs: [older, newer] }, 200));

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ state: "succeeded", runId: 20 });
  });

  it("should break a created_at tie by the highest run id", async () => {
    // Arrange
    const tiedTimestamp = "2026-09-23T10:00:00Z";
    const lower = workflowRun({ id: 30, status: "completed", conclusion: "failure", created_at: tiedTimestamp });
    const higher = workflowRun({ id: 40, status: "completed", conclusion: "success", created_at: tiedTimestamp });
    const { fetchImpl } = fakeFetch(() => jsonResponse({ workflow_runs: [lower, higher] }, 200));

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ state: "succeeded", runId: 40 });
  });

  it("should return malformed_response when the response body has no workflow_runs array", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ not_workflow_runs: [] }, 200));

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "malformed_response" });
  });

  it("should return malformed_response when a run entry is missing required fields", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ workflow_runs: [{ id: 1 }] }, 200));

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "malformed_response" });
  });

  it("should return malformed_response when the response body is not valid JSON", async () => {
    // Arrange
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "malformed_response" });
  });

  it("should return runs_lookup_failed with the safe http status on a non-2xx GitHub response, never the response body", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "distinctive-secret-should-not-leak" }, 403));

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "runs_lookup_failed", httpStatus: 403 });
    expect(JSON.stringify(result)).not.toContain("distinctive-secret-should-not-leak");
  });

  it("should return runs_lookup_network_error when the fetch call rejects", async () => {
    // Arrange
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "runs_lookup_network_error" });
  });

  it("should return credential_unavailable, passing through the credential failure reason, when minting fails", async () => {
    // Arrange
    const { calls } = fakeFetch(() => jsonResponse({ workflow_runs: [] }, 200));
    const failingMintCredential: MintGithubDeliveryCredential = async () => ({
      ok: false,
      reason: "token_exchange_failed",
      httpStatus: 403,
    });
    const fetchImpl = (async () => {
      throw new Error("should not be called when credential minting fails");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: failingMintCredential });

    // Assert
    expect(result).toEqual({
      ok: false,
      reason: "credential_unavailable",
      credentialReason: "token_exchange_failed",
      httpStatus: 403,
    });
    expect(calls).toHaveLength(0);
  });

  it("should return credential_unavailable without httpStatus when the credential failure carries none", async () => {
    // Arrange
    const failingMintCredential: MintGithubDeliveryCredential = async () => ({ ok: false, reason: "config_invalid" });
    const fetchImpl = (async () => {
      throw new Error("should not be called when credential minting fails");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: failingMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "credential_unavailable", credentialReason: "config_invalid" });
  });

  it("should never include the minted token in any returned outcome", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ status: "completed", conclusion: "success" })] }, 200),
    );

    // Act
    const result = await observeDeliveryCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(JSON.stringify(result)).not.toContain("minted-installation-token");
  });
});
