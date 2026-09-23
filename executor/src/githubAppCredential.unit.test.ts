import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it } from "vitest";

import { mintGithubDeliveryCredential } from "./githubAppCredential";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const VALID_ENV = {
  ADA_GITHUB_APP_ID: "123456",
  ADA_GITHUB_APP_PRIVATE_KEY: privateKey,
  ADA_GITHUB_APP_INSTALLATION_ID: "987654",
};

const FIXED_NOW_MS = Date.parse("2026-09-23T12:00:00.000Z");
const fixedNow = () => FIXED_NOW_MS;

function decodeJwtPart(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

function verifyJwtSignature(jwt: string): boolean {
  const [headerPart, payloadPart, signaturePart] = jwt.split(".");
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerPart}.${payloadPart}`);
  verifier.end();
  return verifier.verify(publicKey, Buffer.from(signaturePart, "base64url"));
}

function fakeFetchOk(responseBody: unknown, status = 201) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(responseBody), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("mintGithubDeliveryCredential", () => {
  it("rejects a missing ADA_GITHUB_APP_ID", async () => {
    // Arrange
    const env = { ...VALID_ENV, ADA_GITHUB_APP_ID: undefined };
    const { fetchImpl } = fakeFetchOk({ token: "x", expires_at: "2026-09-23T13:00:00Z" });

    // Act
    const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env, now: fixedNow, fetchImpl });

    // Assert
    expect(result).toEqual({ ok: false, reason: "config_invalid" });
  });

  it("rejects a missing ADA_GITHUB_APP_PRIVATE_KEY", async () => {
    // Arrange
    const env = { ...VALID_ENV, ADA_GITHUB_APP_PRIVATE_KEY: undefined };
    const { fetchImpl } = fakeFetchOk({ token: "x", expires_at: "2026-09-23T13:00:00Z" });

    // Act
    const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env, now: fixedNow, fetchImpl });

    // Assert
    expect(result).toEqual({ ok: false, reason: "config_invalid" });
  });

  it("rejects a missing ADA_GITHUB_APP_INSTALLATION_ID", async () => {
    // Arrange
    const env = { ...VALID_ENV, ADA_GITHUB_APP_INSTALLATION_ID: undefined };
    const { fetchImpl } = fakeFetchOk({ token: "x", expires_at: "2026-09-23T13:00:00Z" });

    // Act
    const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env, now: fixedNow, fetchImpl });

    // Assert
    expect(result).toEqual({ ok: false, reason: "config_invalid" });
  });

  it("rejects a blank ADA_GITHUB_APP_ID", async () => {
    // Arrange
    const env = { ...VALID_ENV, ADA_GITHUB_APP_ID: "   " };
    const { fetchImpl } = fakeFetchOk({ token: "x", expires_at: "2026-09-23T13:00:00Z" });

    // Act
    const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env, now: fixedNow, fetchImpl });

    // Assert
    expect(result).toEqual({ ok: false, reason: "config_invalid" });
  });

  it("returns jwt_signing_failed when the private key is not a valid PEM", async () => {
    // Arrange
    const env = { ...VALID_ENV, ADA_GITHUB_APP_PRIVATE_KEY: "not-a-real-pem" };
    const { fetchImpl } = fakeFetchOk({ token: "x", expires_at: "2026-09-23T13:00:00Z" });

    // Act
    const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env, now: fixedNow, fetchImpl });

    // Assert
    expect(result).toEqual({ ok: false, reason: "jwt_signing_failed" });
  });

  it("mints a valid RS256 App JWT and exchanges it for an installation token", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetchOk({ token: "minted-installation-token", expires_at: "2026-09-23T13:00:00Z" });

    // Act
    const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env: VALID_ENV, now: fixedNow, fetchImpl });

    // Assert
    expect(result).toEqual({ ok: true, token: "minted-installation-token", expiresAt: "2026-09-23T13:00:00Z" });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.github.com/app/installations/987654/access_tokens");
    expect(calls[0].init?.method).toBe("POST");
    const headers = calls[0].init?.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/vnd.github+json");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
    expect(headers["Content-Type"]).toBe("application/json");

    const authHeader = headers.Authorization;
    expect(authHeader).toMatch(/^Bearer /);
    const jwt = authHeader.replace("Bearer ", "");

    const [headerPart, payloadPart] = jwt.split(".");
    expect(decodeJwtPart(headerPart)).toEqual({ alg: "RS256", typ: "JWT" });
    const payload = decodeJwtPart(payloadPart) as { iat: number; exp: number; iss: string };
    expect(payload.iss).toBe("123456");
    const fixedNowSeconds = Math.floor(FIXED_NOW_MS / 1000);
    expect(payload.iat).toBe(fixedNowSeconds - 60);
    expect(payload.exp).toBe(fixedNowSeconds + 480);
    expect(payload.exp - payload.iat).toBeLessThan(600);

    expect(verifyJwtSignature(jwt)).toBe(true);
  });

  it("scopes the minted token to only the requested repository, not the App's full installation", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetchOk({ token: "minted-installation-token", expires_at: "2026-09-23T13:00:00Z" });

    // Act
    await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env: VALID_ENV, now: fixedNow, fetchImpl });

    // Assert — GitHub's installation access-token API narrows scope to exactly the named
    // repositories when a `repositories` body is supplied; omitting it would grant every repo the
    // App happens to be installed on. The API expects the bare repo name (owner is implicit).
    expect(calls).toHaveLength(1);
    const body = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(body).toEqual({ repositories: ["kanban-app"] });
  });

  it("derives the repositories scope from a different repository identity, proving it is not hardcoded", async () => {
    // Arrange
    const { fetchImpl, calls } = fakeFetchOk({ token: "minted-installation-token", expires_at: "2026-09-23T13:00:00Z" });

    // Act
    await mintGithubDeliveryCredential({ repository: "some-org/some-other-repo", env: VALID_ENV, now: fixedNow, fetchImpl });

    // Assert
    const body = JSON.parse((calls[0].init?.body as string) ?? "{}");
    expect(body).toEqual({ repositories: ["some-other-repo"] });
  });

  it("supports a private key whose newlines are escaped as literal \\n", async () => {
    // Arrange
    const escapedKey = privateKey.replace(/\n/g, "\\n");
    const env = { ...VALID_ENV, ADA_GITHUB_APP_PRIVATE_KEY: escapedKey };
    const { fetchImpl } = fakeFetchOk({ token: "minted-installation-token", expires_at: "2026-09-23T13:00:00Z" });

    // Act
    const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env, now: fixedNow, fetchImpl });

    // Assert
    expect(result).toEqual({ ok: true, token: "minted-installation-token", expiresAt: "2026-09-23T13:00:00Z" });
  });

  it("returns token_exchange_failed with the safe http status on a non-2xx response", async () => {
    // Arrange
    const fetchImpl = (async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })) as unknown as typeof fetch;

    // Act
    const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env: VALID_ENV, now: fixedNow, fetchImpl });

    // Assert
    expect(result).toEqual({ ok: false, reason: "token_exchange_failed", httpStatus: 401 });
  });

  it("never includes the response body in a failure outcome", async () => {
    // Arrange
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: "distinctive-secret-should-not-leak" }), { status: 403 })) as unknown as typeof fetch;

    // Act
    const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env: VALID_ENV, now: fixedNow, fetchImpl });

    // Assert
    expect(JSON.stringify(result)).not.toContain("distinctive-secret-should-not-leak");
  });

  it("returns token_exchange_network_error when fetch rejects", async () => {
    // Arrange
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    // Act
    const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env: VALID_ENV, now: fixedNow, fetchImpl });

    // Assert
    expect(result).toEqual({ ok: false, reason: "token_exchange_network_error" });
  });

  it("returns token_exchange_failed when the success response body is malformed", async () => {
    // Arrange
    const fetchImpl = (async () => new Response(JSON.stringify({ unexpected: "shape" }), { status: 201 })) as unknown as typeof fetch;

    // Act
    const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env: VALID_ENV, now: fixedNow, fetchImpl });

    // Assert
    expect(result).toEqual({ ok: false, reason: "token_exchange_failed", httpStatus: 201 });
  });

  describe("credential isolation", () => {
    it("never includes the private key in any failure outcome", async () => {
      // Arrange
      const env = { ...VALID_ENV, ADA_GITHUB_APP_PRIVATE_KEY: "not-a-real-pem" };
      const { fetchImpl } = fakeFetchOk({ token: "x", expires_at: "2026-09-23T13:00:00Z" });

      // Act
      const result = await mintGithubDeliveryCredential({ repository: "johnpwise/kanban-app", env, now: fixedNow, fetchImpl });

      // Assert
      expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
    });
  });
});
