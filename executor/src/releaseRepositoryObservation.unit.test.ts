import { describe, expect, it } from "vitest";

import { observeCommit, observeFileContent, observeGitRefSha, observeRepositoryPackageVersion } from "./releaseRepositoryObservation";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";

const REPOSITORY = "johnpwise/kanban-app";
const HEAD_SHA = "a".repeat(40);

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

describe("observeGitRefSha", () => {
  it("returns found:true with the sha for an existing ref", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ object: { sha: HEAD_SHA } }, 200));

    // Act
    const result = await observeGitRefSha({
      repository: REPOSITORY,
      ref: "heads/develop",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: true, found: true, sha: HEAD_SHA });
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`https://api.github.com/repos/${REPOSITORY}/git/ref/heads/develop`);
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer minted-installation-token");
  });

  it("returns found:false, not an error, for a 404 (ref does not exist)", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "Not Found" }, 404));

    // Act
    const result = await observeGitRefSha({
      repository: REPOSITORY,
      ref: "heads/release/9.9.9",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: true, found: false });
  });

  it("returns ref_lookup_failed with the safe http status on a non-404 non-2xx response", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "secret-should-not-leak" }, 500));

    // Act
    const result = await observeGitRefSha({
      repository: REPOSITORY,
      ref: "heads/develop",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "ref_lookup_failed", httpStatus: 500 });
    expect(JSON.stringify(result)).not.toContain("secret-should-not-leak");
  });

  it("returns ref_lookup_network_error when the fetch call rejects", async () => {
    // Arrange
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeGitRefSha({
      repository: REPOSITORY,
      ref: "heads/develop",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "ref_lookup_network_error" });
  });

  it("returns ref_response_invalid when the 200 response body has no object.sha", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ object: {} }, 200));

    // Act
    const result = await observeGitRefSha({
      repository: REPOSITORY,
      ref: "heads/develop",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "ref_response_invalid" });
  });

  it("returns ref_response_invalid when the response body is not valid JSON", async () => {
    // Arrange
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;

    // Act
    const result = await observeGitRefSha({
      repository: REPOSITORY,
      ref: "heads/develop",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "ref_response_invalid" });
  });

  it("returns credential_unavailable, passing through the credential failure reason, when minting fails", async () => {
    // Arrange
    const { calls } = fakeFetch(() => jsonResponse({ object: { sha: HEAD_SHA } }, 200));
    const failingMintCredential: MintGithubDeliveryCredential = async () => ({
      ok: false,
      reason: "token_exchange_failed",
      httpStatus: 403,
    });
    const fetchImpl = (async () => {
      throw new Error("should not be called when credential minting fails");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeGitRefSha({
      repository: REPOSITORY,
      ref: "heads/develop",
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
});

describe("observeRepositoryPackageVersion", () => {
  function contentsResponse(version: string) {
    return {
      content: Buffer.from(JSON.stringify({ version })).toString("base64"),
      encoding: "base64",
    };
  }

  it("returns found:true with the decoded package version", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(contentsResponse("0.1.0"), 200));

    // Act
    const result = await observeRepositoryPackageVersion({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: true, found: true, version: "0.1.0" });
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`https://api.github.com/repos/${REPOSITORY}/contents/package.json`);
    expect(url.searchParams.get("ref")).toBe(HEAD_SHA);
  });

  it("returns found:false, not an error, for a 404 (path does not exist at that ref)", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "Not Found" }, 404));

    // Act
    const result = await observeRepositoryPackageVersion({
      repository: REPOSITORY,
      ref: "does-not-exist",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: true, found: false });
  });

  it("returns package_lookup_failed with the safe http status on a non-404 non-2xx response", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "secret-should-not-leak" }, 500));

    // Act
    const result = await observeRepositoryPackageVersion({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "package_lookup_failed", httpStatus: 500 });
    expect(JSON.stringify(result)).not.toContain("secret-should-not-leak");
  });

  it("returns package_lookup_network_error when the fetch call rejects", async () => {
    // Arrange
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeRepositoryPackageVersion({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "package_lookup_network_error" });
  });

  it("returns package_response_invalid when the response body is not valid JSON", async () => {
    // Arrange
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;

    // Act
    const result = await observeRepositoryPackageVersion({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "package_response_invalid" });
  });

  it("returns package_response_invalid when the response body has no content field", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ encoding: "base64" }, 200));

    // Act
    const result = await observeRepositoryPackageVersion({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "package_response_invalid" });
  });

  it("returns package_content_invalid when the decoded content is not valid JSON", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ content: Buffer.from("not json").toString("base64"), encoding: "base64" }, 200),
    );

    // Act
    const result = await observeRepositoryPackageVersion({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "package_content_invalid" });
  });

  it("returns package_content_invalid when the decoded JSON has no string version field", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ content: Buffer.from(JSON.stringify({ name: "x" })).toString("base64"), encoding: "base64" }, 200),
    );

    // Act
    const result = await observeRepositoryPackageVersion({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "package_content_invalid" });
  });

  it("returns credential_unavailable, passing through the credential failure reason, when minting fails", async () => {
    // Arrange
    const { calls } = fakeFetch(() => jsonResponse(contentsResponse("0.1.0"), 200));
    const failingMintCredential: MintGithubDeliveryCredential = async () => ({ ok: false, reason: "config_invalid" });
    const fetchImpl = (async () => {
      throw new Error("should not be called when credential minting fails");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeRepositoryPackageVersion({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      fetchImpl,
      mintCredential: failingMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "credential_unavailable", credentialReason: "config_invalid" });
    expect(calls).toHaveLength(0);
  });
});

describe("observeCommit", () => {
  const COMMIT_SHA = "c".repeat(40);
  const PARENT_SHA = "a".repeat(40);

  function commitResponse(overrides: Record<string, unknown> = {}) {
    return {
      sha: COMMIT_SHA,
      commit: { message: "chore(release): prepare v0.2.0" },
      parents: [{ sha: PARENT_SHA }],
      files: [{ filename: "package-lock.json" }, { filename: "package.json" }],
      ...overrides,
    };
  }

  it("returns found:true with message, parent SHAs, and changed files for an existing commit", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(commitResponse(), 200));

    // Act
    const result = await observeCommit({
      repository: REPOSITORY,
      sha: COMMIT_SHA,
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({
      ok: true,
      found: true,
      commit: {
        sha: COMMIT_SHA,
        message: "chore(release): prepare v0.2.0",
        parentShas: [PARENT_SHA],
        changedFiles: ["package-lock.json", "package.json"],
      },
    });
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`https://api.github.com/repos/${REPOSITORY}/commits/${COMMIT_SHA}`);
  });

  it("returns found:false, not an error, for a 404 (commit does not exist)", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "Not Found" }, 404));

    // Act
    const result = await observeCommit({ repository: REPOSITORY, sha: COMMIT_SHA, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: true, found: false });
  });

  it("returns commit_lookup_failed with the safe http status on a non-404 non-2xx response", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "secret-should-not-leak" }, 500));

    // Act
    const result = await observeCommit({ repository: REPOSITORY, sha: COMMIT_SHA, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "commit_lookup_failed", httpStatus: 500 });
    expect(JSON.stringify(result)).not.toContain("secret-should-not-leak");
  });

  it("returns commit_lookup_network_error when the fetch call rejects", async () => {
    // Arrange
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeCommit({ repository: REPOSITORY, sha: COMMIT_SHA, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "commit_lookup_network_error" });
  });

  it("returns commit_response_invalid when the response body has no parents array", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ sha: COMMIT_SHA, commit: { message: "x" }, files: [] }, 200));

    // Act
    const result = await observeCommit({ repository: REPOSITORY, sha: COMMIT_SHA, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "commit_response_invalid" });
  });

  it("returns commit_response_invalid when files is absent", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse(commitResponse({ files: undefined }), 200));

    // Act
    const result = await observeCommit({ repository: REPOSITORY, sha: COMMIT_SHA, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "commit_response_invalid" });
  });

  it("returns commit_response_invalid when the response body is not valid JSON", async () => {
    // Arrange
    const fetchImpl = (async () => new Response("not json", { status: 200 })) as unknown as typeof fetch;

    // Act
    const result = await observeCommit({ repository: REPOSITORY, sha: COMMIT_SHA, fetchImpl, mintCredential: okMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "commit_response_invalid" });
  });

  it("returns credential_unavailable, passing through the credential failure reason, when minting fails", async () => {
    // Arrange
    const { calls } = fakeFetch(() => jsonResponse(commitResponse(), 200));
    const failingMintCredential: MintGithubDeliveryCredential = async () => ({ ok: false, reason: "config_invalid" });
    const fetchImpl = (async () => {
      throw new Error("should not be called when credential minting fails");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeCommit({ repository: REPOSITORY, sha: COMMIT_SHA, fetchImpl, mintCredential: failingMintCredential });

    // Assert
    expect(result).toEqual({ ok: false, reason: "credential_unavailable", credentialReason: "config_invalid" });
    expect(calls).toHaveLength(0);
  });
});

describe("observeFileContent", () => {
  function contentsResponse(text: string) {
    return { content: Buffer.from(text).toString("base64"), encoding: "base64" };
  }

  it("returns found:true with the decoded utf8 text content", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse(contentsResponse('{"version":"0.1.0"}'), 200));

    // Act
    const result = await observeFileContent({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      path: "package-lock.json",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: true, found: true, content: '{"version":"0.1.0"}' });
    const url = new URL(calls[0].url);
    expect(url.origin + url.pathname).toBe(`https://api.github.com/repos/${REPOSITORY}/contents/package-lock.json`);
    expect(url.searchParams.get("ref")).toBe(HEAD_SHA);
  });

  it("returns found:false, not an error, for a 404 (path does not exist at that ref)", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "Not Found" }, 404));

    // Act
    const result = await observeFileContent({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      path: "package-lock.json",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: true, found: false });
  });

  it("returns file_lookup_failed with the safe http status on a non-404 non-2xx response", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ message: "secret-should-not-leak" }, 500));

    // Act
    const result = await observeFileContent({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      path: "package-lock.json",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "file_lookup_failed", httpStatus: 500 });
    expect(JSON.stringify(result)).not.toContain("secret-should-not-leak");
  });

  it("returns file_lookup_network_error when the fetch call rejects", async () => {
    // Arrange
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeFileContent({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      path: "package-lock.json",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "file_lookup_network_error" });
  });

  it("returns file_response_invalid when the response body has no content field", async () => {
    // Arrange
    const { fetchImpl } = fakeFetch(() => jsonResponse({ encoding: "base64" }, 200));

    // Act
    const result = await observeFileContent({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      path: "package-lock.json",
      fetchImpl,
      mintCredential: okMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "file_response_invalid" });
  });

  it("returns credential_unavailable, passing through the credential failure reason, when minting fails", async () => {
    // Arrange
    const { calls } = fakeFetch(() => jsonResponse(contentsResponse("{}"), 200));
    const failingMintCredential: MintGithubDeliveryCredential = async () => ({ ok: false, reason: "config_invalid" });
    const fetchImpl = (async () => {
      throw new Error("should not be called when credential minting fails");
    }) as unknown as typeof fetch;

    // Act
    const result = await observeFileContent({
      repository: REPOSITORY,
      ref: HEAD_SHA,
      path: "package-lock.json",
      fetchImpl,
      mintCredential: failingMintCredential,
    });

    // Assert
    expect(result).toEqual({ ok: false, reason: "credential_unavailable", credentialReason: "config_invalid" });
    expect(calls).toHaveLength(0);
  });
});
