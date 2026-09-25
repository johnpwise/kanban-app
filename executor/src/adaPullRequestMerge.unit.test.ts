import { describe, expect, it } from "vitest";

import { mergeAdaPullRequest } from "./adaPullRequestMerge";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";

const REPOSITORY = "johnpwise/kanban-app";
const PULL_REQUEST_NUMBER = 42;
const EXPECTED_HEAD_SHA = "a".repeat(40);
const MERGE_COMMIT_SHA = "c".repeat(40);

const BASE_REQUEST = {
  repository: REPOSITORY,
  pullRequestNumber: PULL_REQUEST_NUMBER,
  expectedHeadSha: EXPECTED_HEAD_SHA,
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

describe("mergeAdaPullRequest", () => {
  it("should PUT the merge endpoint with the explicit merge method and the expected head SHA precondition", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ sha: MERGE_COMMIT_SHA, merged: true, message: "Pull Request successfully merged" }, 200));

    // Act
    await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`https://api.github.com/repos/${REPOSITORY}/pulls/${PULL_REQUEST_NUMBER}/merge`);
    expect(calls[0].init?.method).toBe("PUT");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer minted-installation-token");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({
      merge_method: "merge",
      sha: EXPECTED_HEAD_SHA,
    });
  });

  it("should return merged with the GitHub merge commit SHA on a positive merge response", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ sha: MERGE_COMMIT_SHA, merged: true, message: "Pull Request successfully merged" }, 200));

    // Act
    const result = await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, mergeCommitSha: MERGE_COMMIT_SHA });
  });

  it("should return credential_unavailable, passing through the credential failure reason, when minting fails", async () => {
    // Arrange
    const failingMintCredential: MintGithubDeliveryCredential = async () => ({
      ok: false,
      reason: "token_exchange_failed",
      httpStatus: 403,
    });
    const { fetchImpl, calls } = fakeFetch(() => {
      throw new Error("should not be called when credential minting fails");
    });

    // Act
    const result = await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: failingMintCredential });

    // Assert
    expect(result).toEqual({
      ok: false,
      reason: "credential_unavailable",
      credentialReason: "token_exchange_failed",
      httpStatus: 403,
    });
    expect(calls).toHaveLength(0);
  });

  it("should return pull_request_head_changed on a 409 — the race-protection case — without retrying", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ message: "Head branch was modified. Review and try the merge again." }, 409));

    // Act
    const result = await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "pull_request_head_changed" });
    expect(calls).toHaveLength(1);
  });

  it("should return not_mergeable on a 405", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "Pull Request is not mergeable" }, 405));

    // Act
    const result = await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "not_mergeable" });
  });

  it("should return merge_permission_denied on a 403, never leaking the response body", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "distinctive-secret-should-not-leak" }, 403));

    // Act
    const result = await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "merge_permission_denied" });
    expect(JSON.stringify(result)).not.toContain("distinctive-secret-should-not-leak");
  });

  it("should return merge_failed with the safe http status for any other non-ok response", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "distinctive-secret-should-not-leak" }, 404));

    // Act
    const result = await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "merge_failed", httpStatus: 404 });
    expect(JSON.stringify(result)).not.toContain("distinctive-secret-should-not-leak");
  });

  it("should return merge_network_error when the fetch call rejects", async () => {
    // Arrange
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    // Act
    const result = await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "merge_network_error" });
  });

  it("should return invalid_response when the 200 response body is not valid JSON", async () => {
    // Arrange
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;

    // Act
    const result = await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("should return invalid_response when the 200 response body fails schema validation", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ merged: true }, 200));

    // Act
    const result = await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("should never treat a syntactically valid 200 response with merged:false as success", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ sha: MERGE_COMMIT_SHA, merged: false, message: "not merged" }, 200));

    // Act
    const result = await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "invalid_response" });
  });

  it("should never leak the minted credential or raw response bodies through its result", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ sha: MERGE_COMMIT_SHA, merged: true, message: "Pull Request successfully merged" }, 200));

    // Act
    const result = await mergeAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(JSON.stringify(result)).not.toContain("minted-installation-token");
  });
});
