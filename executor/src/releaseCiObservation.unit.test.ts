import { describe, expect, it } from "vitest";

import { observeReleaseCiStatus, parseReleaseCiRunIdentity } from "./releaseCiObservation";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";

const REPOSITORY = "johnpwise/kanban-app";
const MAIN_PR_SHA = "a".repeat(40);

const MAIN_IDENTITY = {
  prNumber: 64,
  baseBranch: "main",
  headBranch: "release/0.1.1",
  headSha: MAIN_PR_SHA,
};

const BASE_REQUEST = {
  repository: REPOSITORY,
  expectedIdentity: MAIN_IDENTITY,
};

const okMintCredential: MintGithubDeliveryCredential = async () => ({
  ok: true,
  token: "minted-installation-token",
  expiresAt: "2026-09-26T13:00:00Z",
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

function runName(identity: { prNumber: number; baseBranch: string; headBranch: string; headSha: string }): string {
  return `ADA-RELEASE-CI pr=${identity.prNumber} base=${identity.baseBranch} head=${identity.headBranch} sha=${identity.headSha}`;
}

function workflowRun(overrides: Partial<{
  id: number;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  event: string;
  display_title: string;
}> = {}) {
  return {
    id: 1,
    head_sha: MAIN_PR_SHA,
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/johnpwise/kanban-app/actions/runs/1",
    created_at: "2026-09-26T10:00:00Z",
    event: "pull_request",
    display_title: runName(MAIN_IDENTITY),
    ...overrides,
  };
}

describe("parseReleaseCiRunIdentity", () => {
  it("should parse a well-formed run-name into its structured identity", () => {
    // Arrange
    const name = `ADA-RELEASE-CI pr=64 base=main head=release/0.1.1 sha=${MAIN_PR_SHA}`;

    // Act
    const result = parseReleaseCiRunIdentity(name);

    // Assert
    expect(result).toEqual({ prNumber: 64, baseBranch: "main", headBranch: "release/0.1.1", headSha: MAIN_PR_SHA });
  });

  it.each([
    ["wrong prefix", `NOT-ADA-RELEASE-CI pr=64 base=main head=release/0.1.1 sha=${MAIN_PR_SHA}`],
    ["non-numeric pr", `ADA-RELEASE-CI pr=abc base=main head=release/0.1.1 sha=${MAIN_PR_SHA}`],
    ["short sha", "ADA-RELEASE-CI pr=64 base=main head=release/0.1.1 sha=abc123"],
    ["uppercase sha", `ADA-RELEASE-CI pr=64 base=main head=release/0.1.1 sha=${"A".repeat(40)}`],
    ["missing head field", `ADA-RELEASE-CI pr=64 base=main sha=${MAIN_PR_SHA}`],
    ["extra trailing content", `ADA-RELEASE-CI pr=64 base=main head=release/0.1.1 sha=${MAIN_PR_SHA} extra=1`],
    ["a plain commit message (legacy default run-name)", "Fix typo in README"],
    ["empty string", ""],
  ])("should return null for a malformed run-name (%s)", (_label, name) => {
    // Act
    const result = parseReleaseCiRunIdentity(name);

    // Assert
    expect(result).toBeNull();
  });
});

describe("observeReleaseCiStatus", () => {
  it("should return pending when no workflow run matches the expected head SHA", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ workflow_runs: [] }, 200));

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(
      "https://api.github.com/repos/johnpwise/kanban-app/actions/workflows/ci.yml/runs",
    );
    expect(url.searchParams.get("head_sha")).toBe(MAIN_PR_SHA);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer minted-installation-token");
  });

  it("should return pending when the matching run is queued", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ status: "queued", conclusion: null })] }, 200),
    );

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
  });

  it("should return pending when the matching run is in_progress", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ status: "in_progress", conclusion: null })] }, 200),
    );

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
  });

  it("should return succeeded when the matching run completed with conclusion success", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ id: 501, status: "completed", conclusion: "success" })] }, 200),
    );

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

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
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

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
      const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

      // Assert
      expect(result).toMatchObject({ ok: true, state: "failed", conclusion });
    },
  );

  it("should return failed, never pending or succeeded, when a completed matching run has a null conclusion", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ status: "completed", conclusion: null })] }, 200),
    );

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ ok: true, state: "failed" });
  });

  it("should not trust a successful run whose run-name identifies the OTHER release PR sharing the same SHA", async () => {
    // Arrange — the develop-target PR's own successful run is present for the same commit; the
    // main-target PR's identity must not be satisfied by it.
    const otherPrRun = workflowRun({
      id: 999,
      status: "completed",
      conclusion: "success",
      display_title: runName({ prNumber: 65, baseBranch: "develop", headBranch: "release/0.1.1", headSha: MAIN_PR_SHA }),
    });
    const { fetchImpl } = fakeFetch(() => jsonResponse({ workflow_runs: [otherPrRun] }, 200));

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
  });

  it("should not let the other release PR's newer successful run displace the intended PR's own valid pending state", async () => {
    // Arrange
    const ownRun = workflowRun({
      id: 100,
      status: "in_progress",
      conclusion: null,
      created_at: "2026-09-26T09:00:00Z",
    });
    const otherPrNewerRun = workflowRun({
      id: 200,
      status: "completed",
      conclusion: "success",
      created_at: "2026-09-26T11:00:00Z",
      display_title: runName({ prNumber: 65, baseBranch: "develop", headBranch: "release/0.1.1", headSha: MAIN_PR_SHA }),
    });
    const { fetchImpl } = fakeFetch(() => jsonResponse({ workflow_runs: [ownRun, otherPrNewerRun] }, 200));

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
  });

  it("should fail closed (not match) when the run-name base branch disagrees with the expected identity", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(
        {
          workflow_runs: [
            workflowRun({
              status: "completed",
              conclusion: "success",
              display_title: runName({ ...MAIN_IDENTITY, baseBranch: "develop" }),
            }),
          ],
        },
        200,
      ),
    );

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
  });

  it("should fail closed (not match) when the run-name head branch disagrees with the expected identity", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(
        {
          workflow_runs: [
            workflowRun({
              status: "completed",
              conclusion: "success",
              display_title: runName({ ...MAIN_IDENTITY, headBranch: "release/0.1.2" }),
            }),
          ],
        },
        200,
      ),
    );

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
  });

  it("should fail closed (not match) when the run's own head_sha disagrees with the expected identity, even if the run-name claims otherwise", async () => {
    // Arrange — defense in depth: never trust the run-name string over the API's own head_sha field.
    const otherSha = "c".repeat(40);
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(
        { workflow_runs: [workflowRun({ head_sha: otherSha, status: "completed", conclusion: "success" })] },
        200,
      ),
    );

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
  });

  it("should ignore a matching-identity run whose event is not pull_request", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ status: "completed", conclusion: "success", event: "push" })] }, 200),
    );

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "pending" });
  });

  it("should return unbound when a run for the expected head SHA carries no parseable structured identity (legacy/pre-contract run)", async () => {
    // Arrange — mirrors the real, live 0.1.1 runs, which predate this contract.
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(
        { workflow_runs: [workflowRun({ status: "completed", conclusion: "success", display_title: "Release 0.1.1 → main" })] },
        200,
      ),
    );

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "unbound" });
  });

  it("should return unbound, not succeeded, when only a malformed structured identity is present for the expected head SHA", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(
        {
          workflow_runs: [
            workflowRun({ status: "completed", conclusion: "success", display_title: "ADA-RELEASE-CI pr=not-a-number base=main" }),
          ],
        },
        200,
      ),
    );

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, state: "unbound" });
  });

  it("should resolve multiple matching runs deterministically by most recent created_at, ignoring array order", async () => {
    // Arrange
    const older = workflowRun({ id: 10, status: "completed", conclusion: "failure", created_at: "2026-09-26T09:00:00Z" });
    const newer = workflowRun({ id: 20, status: "completed", conclusion: "success", created_at: "2026-09-26T10:00:00Z" });
    const { fetchImpl } = fakeFetch(() => jsonResponse({ workflow_runs: [older, newer] }, 200));

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ state: "succeeded", runId: 20 });
  });

  it("should give the same result regardless of the API response array order", async () => {
    // Arrange
    const older = workflowRun({ id: 10, status: "completed", conclusion: "failure", created_at: "2026-09-26T09:00:00Z" });
    const newer = workflowRun({ id: 20, status: "completed", conclusion: "success", created_at: "2026-09-26T10:00:00Z" });
    const { fetchImpl } = fakeFetch(() => jsonResponse({ workflow_runs: [newer, older] }, 200));

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ state: "succeeded", runId: 20 });
  });

  it("should break a created_at tie by the highest run id (rerun of the same PR identity)", async () => {
    // Arrange
    const tiedTimestamp = "2026-09-26T10:00:00Z";
    const lower = workflowRun({ id: 30, status: "completed", conclusion: "failure", created_at: tiedTimestamp });
    const higher = workflowRun({ id: 40, status: "completed", conclusion: "success", created_at: tiedTimestamp });
    const { fetchImpl } = fakeFetch(() => jsonResponse({ workflow_runs: [lower, higher] }, 200));

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ state: "succeeded", runId: 40 });
  });

  it("should return malformed_response when the response body has no workflow_runs array", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ not_workflow_runs: [] }, 200));

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "malformed_response" });
  });

  it("should return malformed_response when a run entry is missing required fields", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ workflow_runs: [{ id: 1 }] }, 200));

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "malformed_response" });
  });

  it("should return malformed_response when the response body is not valid JSON", async () => {
    // Arrange
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "malformed_response" });
  });

  it("should return runs_lookup_failed with the safe http status on a non-2xx GitHub response, never the response body", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "distinctive-secret-should-not-leak" }, 403));

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

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
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

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
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: failingMintCredential });

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
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: failingMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "credential_unavailable", credentialReason: "config_invalid" });
  });

  it("should never include the minted token in any returned outcome", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ workflow_runs: [workflowRun({ status: "completed", conclusion: "success" })] }, 200),
    );

    // Act
    const result = await observeReleaseCiStatus({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(JSON.stringify(result)).not.toContain("minted-installation-token");
  });
});
