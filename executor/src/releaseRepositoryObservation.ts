import { z } from "zod";

import type { MintGithubDeliveryCredential, MintGithubDeliveryCredentialOutcome } from "./githubAppCredential";

type CredentialFailureReason = Exclude<MintGithubDeliveryCredentialOutcome, { ok: true }>["reason"];

interface ObservationCredentialParams {
  fetchImpl: typeof fetch;
  mintCredential: MintGithubDeliveryCredential;
}

export interface ObserveGitRefRequest {
  /** The immutable, already-validated `owner/repo` identity. */
  repository: string;
  /** GitHub's git-ref path segment exactly, e.g. `heads/develop` or `tags/v0.2.0`. */
  ref: string;
}

export type ObserveGitRefOutcome =
  | { ok: true; found: true; sha: string }
  | { ok: true; found: false }
  | { ok: false; reason: "credential_unavailable"; credentialReason: CredentialFailureReason; httpStatus?: number }
  | { ok: false; reason: "ref_lookup_failed"; httpStatus: number }
  | { ok: false; reason: "ref_lookup_network_error" }
  | { ok: false; reason: "ref_response_invalid" };

/** `fetchImpl`/`mintCredential` bound once at composition; `repository`/`ref` passed per call. */
export type ObserveGitRefSha = (
  request: ObserveGitRefRequest,
) => Promise<ObserveGitRefOutcome>;

export interface ObservePackageVersionRequest {
  /** The immutable, already-validated `owner/repo` identity. */
  repository: string;
  /** A branch, tag, or exact commit SHA — passed through verbatim as the Contents API's `ref`. */
  ref: string;
}

export type ObservePackageVersionOutcome =
  | { ok: true; found: true; version: string }
  | { ok: true; found: false }
  | { ok: false; reason: "credential_unavailable"; credentialReason: CredentialFailureReason; httpStatus?: number }
  | { ok: false; reason: "package_lookup_failed"; httpStatus: number }
  | { ok: false; reason: "package_lookup_network_error" }
  | { ok: false; reason: "package_response_invalid" }
  | { ok: false; reason: "package_content_invalid" };

/** `fetchImpl`/`mintCredential` bound once at composition; `repository`/`ref` passed per call. */
export type ObservePackageVersion = (
  request: ObservePackageVersionRequest,
) => Promise<ObservePackageVersionOutcome>;

const gitRefResponseSchema = z.object({
  object: z.object({ sha: z.string() }),
});

const contentsResponseSchema = z.object({
  content: z.string(),
  encoding: z.literal("base64"),
});

const packageJsonVersionSchema = z.object({
  version: z.string(),
});

interface CredentialUnavailable {
  ok: false;
  reason: "credential_unavailable";
  credentialReason: CredentialFailureReason;
  httpStatus?: number;
}

async function mintOrFail(
  repository: string,
  mintCredential: MintGithubDeliveryCredential,
): Promise<{ ok: true; token: string } | { ok: false; outcome: CredentialUnavailable }> {
  const credentialOutcome = await mintCredential({ repository });
  if (!credentialOutcome.ok) {
    return {
      ok: false,
      outcome: {
        ok: false,
        reason: "credential_unavailable",
        credentialReason: credentialOutcome.reason,
        ...("httpStatus" in credentialOutcome ? { httpStatus: credentialOutcome.httpStatus } : {}),
      },
    };
  }
  return { ok: true, token: credentialOutcome.token };
}

/**
 * Observes whether a live Git ref (a branch under `heads/` or a tag under `tags/`) exists in
 * `repository`, and its current SHA if so. Reuses the existing GitHub App installation credential
 * mint and the same raw-`fetch` request shape as `deliveryPullRequestObservation.ts`. Read-only: a
 * single GET against `/repos/{repository}/git/ref/{ref}`.
 *
 * A 404 is a genuine, expected outcome (the ref does not exist) — reported as `{ ok: true, found:
 * false }`, never as an error; every other non-2xx response is a distinct `ref_lookup_failed`.
 */
export async function observeGitRefSha(
  params: ObserveGitRefRequest & ObservationCredentialParams,
): Promise<ObserveGitRefOutcome> {
  const { repository, ref, fetchImpl, mintCredential } = params;

  const credential = await mintOrFail(repository, mintCredential);
  if (!credential.ok) {
    return credential.outcome;
  }

  let response: Response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${repository}/git/ref/${ref}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${credential.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    return { ok: false, reason: "ref_lookup_network_error" };
  }

  if (response.status === 404) {
    return { ok: true, found: false };
  }
  if (!response.ok) {
    return { ok: false, reason: "ref_lookup_failed", httpStatus: response.status };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "ref_response_invalid" };
  }

  const parsed = gitRefResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, reason: "ref_response_invalid" };
  }

  return { ok: true, found: true, sha: parsed.data.object.sha };
}

/**
 * Observes the live `package.json` `version` field for `repository` at `ref` (a branch, tag, or
 * exact commit SHA), via the GitHub Contents API. Reuses the existing GitHub App installation
 * credential mint. Read-only: a single GET against
 * `/repos/{repository}/contents/package.json?ref={ref}`.
 *
 * A 404 (no `package.json` at that ref) is a genuine, expected outcome — reported as `{ ok: true,
 * found: false }`, never as an error. `package_response_invalid` covers a malformed Contents API
 * envelope; `package_content_invalid` covers a well-formed envelope whose decoded content is not
 * JSON, or has no string `version` field — kept distinct so a caller can tell "GitHub's API
 * response shape changed" apart from "the repository's own `package.json` is malformed."
 */
export async function observeRepositoryPackageVersion(
  params: ObservePackageVersionRequest & ObservationCredentialParams,
): Promise<ObservePackageVersionOutcome> {
  const { repository, ref, fetchImpl, mintCredential } = params;

  const credential = await mintOrFail(repository, mintCredential);
  if (!credential.ok) {
    return credential.outcome;
  }

  let response: Response;
  try {
    response = await fetchImpl(
      `https://api.github.com/repos/${repository}/contents/package.json?${new URLSearchParams({ ref })}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${credential.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
  } catch {
    return { ok: false, reason: "package_lookup_network_error" };
  }

  if (response.status === 404) {
    return { ok: true, found: false };
  }
  if (!response.ok) {
    return { ok: false, reason: "package_lookup_failed", httpStatus: response.status };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "package_response_invalid" };
  }

  const parsedResponse = contentsResponseSchema.safeParse(body);
  if (!parsedResponse.success) {
    return { ok: false, reason: "package_response_invalid" };
  }

  let decodedJson: unknown;
  try {
    decodedJson = JSON.parse(Buffer.from(parsedResponse.data.content, "base64").toString("utf8"));
  } catch {
    return { ok: false, reason: "package_content_invalid" };
  }

  const parsedPackageJson = packageJsonVersionSchema.safeParse(decodedJson);
  if (!parsedPackageJson.success) {
    return { ok: false, reason: "package_content_invalid" };
  }

  return { ok: true, found: true, version: parsedPackageJson.data.version };
}
