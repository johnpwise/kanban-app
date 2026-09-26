import { describe, expect, it } from "vitest";

import { observeGithubPullRequest } from "./githubPullRequestObservation";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";

const REPOSITORY = "johnpwise/kanban-app";
const PULL_REQUEST_NUMBER = 42;
const HEAD_SHA = "a".repeat(40);

const BASE_REQUEST = {
  repository: REPOSITORY,
  pullRequestNumber: PULL_REQUEST_NUMBER,
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

function githubPullRequest(overrides: Record<string, unknown> = {}) {
  return {
    number: PULL_REQUEST_NUMBER,
    state: "open",
    draft: false,
    merged: false,
    mergeable: true,
    merge_commit_sha: null,
    head: {
      sha: HEAD_SHA,
      ref: "ada/exec-req-123",
      repo: { full_name: REPOSITORY },
    },
    base: {
      ref: "develop",
      repo: { full_name: REPOSITORY },
    },
    ...overrides,
  };
}

describe("observeGithubPullRequest", () => {
  it("should return the observed pull request identity on a successful lookup", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(githubPullRequest(), 200));

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({
      ok: true,
      pullRequest: {
        number: PULL_REQUEST_NUMBER,
        state: "open",
        merged: false,
        draft: false,
        headSha: HEAD_SHA,
        headRef: "ada/exec-req-123",
        headRepositoryFullName: REPOSITORY,
        baseRef: "develop",
        baseRepositoryFullName: REPOSITORY,
        mergeable: true,
        mergeCommitSha: null,
      },
    });
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(
      `https://api.github.com/repos/${REPOSITORY}/pulls/${PULL_REQUEST_NUMBER}`,
    );
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer minted-installation-token");
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("should surface a closed, merged, draft pull request without misclassifying it", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(githubPullRequest({ state: "closed", merged: true, draft: true }), 200),
    );

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ ok: true, pullRequest: { state: "closed", merged: true, draft: true } });
  });

  it("should return mergeable null when GitHub has not yet computed mergeability", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse(githubPullRequest({ mergeable: null }), 200));

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ ok: true, pullRequest: { mergeable: null } });
  });

  it("should return mergeable false for a genuinely conflicting pull request", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse(githubPullRequest({ mergeable: false }), 200));

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ ok: true, pullRequest: { mergeable: false } });
  });

  it("should return the GitHub merge commit SHA when the pull request has been merged", async () => {
    // Arrange
    const MERGE_COMMIT_SHA = "c".repeat(40);
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(githubPullRequest({ state: "closed", merged: true, merge_commit_sha: MERGE_COMMIT_SHA }), 200),
    );

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ ok: true, pullRequest: { merged: true, mergeCommitSha: MERGE_COMMIT_SHA } });
  });

  it("should return mergeCommitSha null for an open, not-yet-merged pull request", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse(githubPullRequest({ merge_commit_sha: null }), 200));

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ ok: true, pullRequest: { mergeCommitSha: null } });
  });

  it("should return pull_request_response_invalid when the response body has no merge_commit_sha field at all", async () => {
    // Arrange
    const malformed = githubPullRequest() as Record<string, unknown>;
    delete malformed.merge_commit_sha;
    const { fetchImpl } = fakeFetch(() => jsonResponse(malformed, 200));

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "pull_request_response_invalid" });
  });

  it("should return headRepositoryFullName null when the head repository is missing (e.g. a deleted fork)", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse(githubPullRequest({ head: { sha: HEAD_SHA, ref: "feature", repo: null } }), 200));

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toMatchObject({ ok: true, pullRequest: { headRepositoryFullName: null } });
  });

  it("should return pull_request_response_invalid when the response body has no head object", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ number: PULL_REQUEST_NUMBER }, 200));

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "pull_request_response_invalid" });
  });

  it("should return pull_request_response_invalid when the response body is not valid JSON", async () => {
    // Arrange
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "pull_request_response_invalid" });
  });

  it("should return pull_request_lookup_failed with the safe http status on a non-2xx GitHub response, never the response body", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "distinctive-secret-should-not-leak" }, 404));

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "pull_request_lookup_failed", httpStatus: 404 });
    expect(JSON.stringify(result)).not.toContain("distinctive-secret-should-not-leak");
  });

  it("should return pull_request_lookup_network_error when the fetch call rejects", async () => {
    // Arrange
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "pull_request_lookup_network_error" });
  });

  it("should return credential_unavailable, passing through the credential failure reason, when minting fails", async () => {
    // Arrange
    const { calls } = fakeFetch(() => jsonResponse(githubPullRequest(), 200));
    const failingMintCredential: MintGithubDeliveryCredential = async () => ({
      ok: false,
      reason: "token_exchange_failed",
      httpStatus: 403,
    });
    const fetchImpl = (async () => {
      throw new Error("should not be called when credential minting fails");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: failingMintCredential });

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
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: failingMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "credential_unavailable", credentialReason: "config_invalid" });
  });

  it("should never include the minted token in any returned outcome", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse(githubPullRequest(), 200));

    // Act
    const result = await observeGithubPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(JSON.stringify(result)).not.toContain("minted-installation-token");
  });
});
