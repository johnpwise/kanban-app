import { describe, expect, it } from "vitest";

import { buildAdaPullRequestTitle, createOrReuseAdaPullRequest } from "./adaPullRequest";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";

const BASE_REQUEST = {
  repository: "johnpwise/kanban-app",
  head: "ada/exec-req-123",
  base: "develop",
  executionRequestId: "exec-req-123",
  deliveryCommitSha: "a".repeat(40),
  title: "Add real-time card sync",
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

describe("buildAdaPullRequestTitle", () => {
  it("uses the trusted run title when non-empty", () => {
    expect(buildAdaPullRequestTitle("Add real-time card sync", "exec-req-123")).toBe("Add real-time card sync");
  });

  it("falls back to a deterministic ADA-owned title when the run title is empty", () => {
    expect(buildAdaPullRequestTitle("", "exec-req-123")).toBe("ADA delivery: exec-req-123");
  });

  it("falls back when the run title is only whitespace", () => {
    expect(buildAdaPullRequestTitle("   ", "exec-req-123")).toBe("ADA delivery: exec-req-123");
  });
});

describe("createOrReuseAdaPullRequest", () => {
  it("creates a PR when no existing open PR matches head/base", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch((call, index) => {
      if (index === 0) return jsonResponse([], 200); // GET lookup: no matches
      return jsonResponse({ number: 42, html_url: "https://github.com/johnpwise/kanban-app/pull/42" }, 201); // POST create
    });

    // Act
    const result = await createOrReuseAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({
      ok: true,
      status: "created",
      number: 42,
      htmlUrl: "https://github.com/johnpwise/kanban-app/pull/42",
    });

    expect(calls).toHaveLength(2);
    const lookupUrl = new URL(calls[0].url);
    expect(lookupUrl.origin + lookupUrl.pathname).toBe("https://api.github.com/repos/johnpwise/kanban-app/pulls");
    expect(lookupUrl.searchParams.get("head")).toBe("johnpwise:ada/exec-req-123");
    expect(lookupUrl.searchParams.get("base")).toBe("develop");
    expect(lookupUrl.searchParams.get("state")).toBe("open");
    const lookupHeaders = calls[0].init?.headers as Record<string, string>;
    expect(lookupHeaders.Authorization).toBe("Bearer minted-installation-token");
    expect(lookupHeaders.Accept).toBe("application/vnd.github+json");
    expect(lookupHeaders["X-GitHub-Api-Version"]).toBe("2022-11-28");

    expect(calls[1].url).toBe("https://api.github.com/repos/johnpwise/kanban-app/pulls");
    expect(calls[1].init?.method).toBe("POST");
    const createHeaders = calls[1].init?.headers as Record<string, string>;
    expect(createHeaders.Authorization).toBe("Bearer minted-installation-token");
    const createBody = JSON.parse((calls[1].init?.body as string) ?? "{}");
    expect(createBody.title).toBe("Add real-time card sync");
    expect(createBody.head).toBe("ada/exec-req-123");
    expect(createBody.base).toBe("develop");
    expect(createBody.body).toContain("exec-req-123");
    expect(createBody.body).toContain("a".repeat(40));
    expect(createBody.body).toContain("develop");
    expect(createBody.body).toContain("Created by ADA");
  });

  it("reuses an existing open PR found by the direct lookup, without attempting to create one", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse([{ number: 7, html_url: "https://github.com/johnpwise/kanban-app/pull/7" }], 200),
    );

    // Act
    const result = await createOrReuseAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({
      ok: true,
      status: "existing",
      number: 7,
      htmlUrl: "https://github.com/johnpwise/kanban-app/pull/7",
    });
    expect(calls).toHaveLength(1);
  });

  it("resolves the existing PR when create races another executor attempt (422)", async () => {
    // Arrange — GET finds nothing, POST 422s (GitHub's "already exists" race response), retry GET
    // now finds the PR the concurrent attempt just created.
    const { fetchImpl, calls } = fakeFetch((call, index) => {
      if (index === 0) return jsonResponse([], 200); // first GET: nothing yet
      if (index === 1) return jsonResponse({ message: "Validation Failed", errors: [{ message: "A pull request already exists for johnpwise:ada/exec-req-123." }] }, 422); // POST races
      return jsonResponse([{ number: 9, html_url: "https://github.com/johnpwise/kanban-app/pull/9" }], 200); // retry GET
    });

    // Act
    const result = await createOrReuseAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({
      ok: true,
      status: "existing",
      number: 9,
      htmlUrl: "https://github.com/johnpwise/kanban-app/pull/9",
    });
    expect(calls).toHaveLength(3);
  });

  it("returns create_failed with the 422 status when the race retry lookup still finds nothing", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch((call, index) => {
      if (index === 0) return jsonResponse([], 200);
      if (index === 1) return jsonResponse({ message: "Validation Failed" }, 422);
      return jsonResponse([], 200); // retry finds nothing either
    });

    // Act
    const result = await createOrReuseAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "create_failed", httpStatus: 422 });
  });

  it("returns credential_unavailable, passing through the credential failure reason, when minting fails", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse([], 200));
    const failingMintCredential: MintGithubDeliveryCredential = async () => ({
      ok: false,
      reason: "token_exchange_failed",
      httpStatus: 403,
    });

    // Act
    const result = await createOrReuseAdaPullRequest({
      ...BASE_REQUEST,
      fetchImpl,
      mintCredential: failingMintCredential,
    });

    // Assert
    expect(result).toEqual({
      ok: false,
      reason: "credential_unavailable",
      credentialReason: "token_exchange_failed",
      httpStatus: 403,
    });
    expect(calls).toHaveLength(0);
  });

  it("returns credential_unavailable without httpStatus when the credential failure carries none", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse([], 200));
    const failingMintCredential: MintGithubDeliveryCredential = async () => ({ ok: false, reason: "config_invalid" });

    // Act
    const result = await createOrReuseAdaPullRequest({
      ...BASE_REQUEST,
      fetchImpl,
      mintCredential: failingMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "credential_unavailable", credentialReason: "config_invalid" });
  });

  it("returns lookup_failed with the safe http status when the GET lookup fails", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "distinctive-secret-should-not-leak" }, 401));

    // Act
    const result = await createOrReuseAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "lookup_failed", httpStatus: 401 });
    expect(JSON.stringify(result)).not.toContain("distinctive-secret-should-not-leak");
  });

  it("returns lookup_network_error when the lookup fetch rejects", async () => {
    // Arrange
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    // Act
    const result = await createOrReuseAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "lookup_network_error" });
  });

  it("returns create_failed with the safe http status on a non-422 create failure, never the response body", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch((call, index) => {
      if (index === 0) return jsonResponse([], 200);
      return jsonResponse({ message: "distinctive-secret-should-not-leak" }, 403);
    });

    // Act
    const result = await createOrReuseAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "create_failed", httpStatus: 403 });
    expect(JSON.stringify(result)).not.toContain("distinctive-secret-should-not-leak");
  });

  it("returns create_network_error when the create fetch rejects", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch((call, index) => {
      if (index === 0) return jsonResponse([], 200);
      throw new Error("network down");
    });

    // Act
    const result = await createOrReuseAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "create_network_error" });
  });

  it("never includes the minted token in any returned outcome", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch((call, index) => {
      if (index === 0) return jsonResponse([], 200);
      return jsonResponse({ number: 42, html_url: "https://github.com/johnpwise/kanban-app/pull/42" }, 201);
    });

    // Act
    const result = await createOrReuseAdaPullRequest({ ...BASE_REQUEST, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(JSON.stringify(result)).not.toContain("minted-installation-token");
  });
});
