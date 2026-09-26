import type { MintGithubDeliveryCredential, MintGithubDeliveryCredentialOutcome } from "./githubAppCredential";

type CredentialFailureReason = Exclude<MintGithubDeliveryCredentialOutcome, { ok: true }>["reason"];

export interface CreateOrReuseGithubPullRequestRequest {
  /** The immutable, already-validated `owner/repo` identity — never derived from workspace `origin`. */
  repository: string;
  /** The head ref for the PR — the source of `owner:head` in the lookup/create request. */
  head: string;
  /** The base ref for the PR. */
  base: string;
  /** The already-resolved PR title (fallback handling, if any, is a caller concern). */
  title: string;
  /** The already-resolved PR body (deterministic, caller-controlled, safe metadata only). */
  body: string;
}

export interface CreateOrReuseGithubPullRequestParams extends CreateOrReuseGithubPullRequestRequest {
  fetchImpl: typeof fetch;
  mintCredential: MintGithubDeliveryCredential;
}

export type CreateOrReuseGithubPullRequestOutcome =
  | { ok: true; status: "created"; number: number; htmlUrl: string }
  | { ok: true; status: "existing"; number: number; htmlUrl: string }
  | { ok: false; reason: "credential_unavailable"; credentialReason: CredentialFailureReason; httpStatus?: number }
  | { ok: false; reason: "lookup_failed"; httpStatus: number }
  | { ok: false; reason: "lookup_network_error" }
  | { ok: false; reason: "create_failed"; httpStatus: number }
  | { ok: false; reason: "create_network_error" };

/** The shape callers depend on: `fetchImpl`/`mintCredential` are bound once at composition time, not per call. */
export type CreateOrReuseGithubPullRequest = (
  request: CreateOrReuseGithubPullRequestRequest,
) => Promise<CreateOrReuseGithubPullRequestOutcome>;

function repositoryOwner(repository: string): string {
  return repository.split("/")[0] ?? repository;
}

interface ExistingPullRequestLookupResult {
  found: true;
  number: number;
  htmlUrl: string;
}
interface ExistingPullRequestLookupFailure {
  found: false;
  outcome: Extract<CreateOrReuseGithubPullRequestOutcome, { ok: false }>;
}

async function findExistingOpenPullRequest(
  params: { repository: string; head: string; base: string; fetchImpl: typeof fetch; token: string },
): Promise<ExistingPullRequestLookupResult | { found: false } | ExistingPullRequestLookupFailure> {
  const url = new URL(`https://api.github.com/repos/${params.repository}/pulls`);
  url.searchParams.set("head", `${repositoryOwner(params.repository)}:${params.head}`);
  url.searchParams.set("base", params.base);
  url.searchParams.set("state", "open");

  let response: Response;
  try {
    response = await params.fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${params.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    return { found: false, outcome: { ok: false, reason: "lookup_network_error" } };
  }

  if (!response.ok) {
    return { found: false, outcome: { ok: false, reason: "lookup_failed", httpStatus: response.status } };
  }

  try {
    const body = (await response.json()) as unknown;
    const first = Array.isArray(body) ? body[0] : undefined;
    if (first && typeof first === "object" && typeof (first as { number?: unknown }).number === "number" && typeof (first as { html_url?: unknown }).html_url === "string") {
      return { found: true, number: (first as { number: number }).number, htmlUrl: (first as { html_url: string }).html_url };
    }
    return { found: false };
  } catch {
    return { found: false, outcome: { ok: false, reason: "lookup_failed", httpStatus: response.status } };
  }
}

/**
 * Creates (or idempotently reuses) a GitHub Pull Request for a caller-verified head/base pair.
 * Reuses the existing GitHub App installation credential mint (`mintCredential`); makes no `git`
 * calls and reads no workspace state, so `repository`/`head`/`base` — all caller-supplied from
 * already-trusted data — are structurally the only inputs that can steer where the PR is opened.
 * Title/body are fully resolved by the caller: this leaf carries no domain-specific
 * (delivery/release) knowledge.
 *
 * Idempotency is resolved against GitHub's live state, not process-local memory: an open PR
 * matching `head`/`base` is looked up first and reused if found. If two attempts race (both find
 * nothing, both try to create), GitHub answers the loser's create with a 422 "already exists" —
 * that case re-runs the lookup once to resolve the winner's PR rather than failing.
 * Never returns response bodies/headers or the credential itself — only safe `httpStatus` values
 * and typed reasons.
 */
export async function createOrReuseGithubPullRequest(
  params: CreateOrReuseGithubPullRequestParams,
): Promise<CreateOrReuseGithubPullRequestOutcome> {
  const { repository, head, base, title, body, fetchImpl, mintCredential } = params;

  const credentialOutcome = await mintCredential({ repository });
  if (!credentialOutcome.ok) {
    return {
      ok: false,
      reason: "credential_unavailable",
      credentialReason: credentialOutcome.reason,
      ...("httpStatus" in credentialOutcome ? { httpStatus: credentialOutcome.httpStatus } : {}),
    };
  }
  const token = credentialOutcome.token;

  const lookup = await findExistingOpenPullRequest({ repository, head, base, fetchImpl, token });
  if ("outcome" in lookup) {
    return lookup.outcome;
  }
  if (lookup.found) {
    return { ok: true, status: "existing", number: lookup.number, htmlUrl: lookup.htmlUrl };
  }

  let createResponse: Response;
  try {
    createResponse = await fetchImpl(`https://api.github.com/repos/${repository}/pulls`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title, head, base, body }),
    });
  } catch {
    return { ok: false, reason: "create_network_error" };
  }

  if (createResponse.ok) {
    try {
      const responseBody = (await createResponse.json()) as { number?: unknown; html_url?: unknown };
      if (typeof responseBody.number === "number" && typeof responseBody.html_url === "string") {
        return { ok: true, status: "created", number: responseBody.number, htmlUrl: responseBody.html_url };
      }
      return { ok: false, reason: "create_failed", httpStatus: createResponse.status };
    } catch {
      return { ok: false, reason: "create_network_error" };
    }
  }

  if (createResponse.status === 422) {
    const retryLookup = await findExistingOpenPullRequest({ repository, head, base, fetchImpl, token });
    if (!("outcome" in retryLookup) && retryLookup.found) {
      return { ok: true, status: "existing", number: retryLookup.number, htmlUrl: retryLookup.htmlUrl };
    }
  }

  return { ok: false, reason: "create_failed", httpStatus: createResponse.status };
}
