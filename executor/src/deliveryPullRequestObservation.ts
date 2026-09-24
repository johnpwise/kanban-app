import { z } from "zod";

import type { MintGithubDeliveryCredential, MintGithubDeliveryCredentialOutcome } from "./githubAppCredential";

type CredentialFailureReason = Exclude<MintGithubDeliveryCredentialOutcome, { ok: true }>["reason"];

export interface ObserveDeliveryPullRequestRequest {
  /** The immutable, already-validated `owner/repo` identity — never derived from workspace `origin`. */
  repository: string;
  /** The durably persisted PR identity (`executionRuns/{id}.delivery.pullRequest.number`) — never a
   * substitute PR discovered by searching for a matching branch. */
  pullRequestNumber: number;
}

export interface ObserveDeliveryPullRequestParams extends ObserveDeliveryPullRequestRequest {
  fetchImpl: typeof fetch;
  mintCredential: MintGithubDeliveryCredential;
}

/** The exact live GitHub identity fields the merge-eligibility trust boundary reconciles against
 * durable ADA state. `headRepositoryFullName` is `null` only when GitHub reports no head
 * repository at all (e.g. a deleted fork) — itself a same-repository-identity failure for the
 * caller to classify. `mergeable` is passed through exactly as GitHub reports it: `true`, `false`,
 * or `null` while GitHub is still computing it — never coerced to a boolean. */
export interface ObservedPullRequest {
  number: number;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  headSha: string;
  headRef: string;
  headRepositoryFullName: string | null;
  baseRef: string;
  baseRepositoryFullName: string;
  mergeable: boolean | null;
}

export type ObserveDeliveryPullRequestOutcome =
  | { ok: true; pullRequest: ObservedPullRequest }
  | { ok: false; reason: "credential_unavailable"; credentialReason: CredentialFailureReason; httpStatus?: number }
  | { ok: false; reason: "pull_request_lookup_failed"; httpStatus: number }
  | { ok: false; reason: "pull_request_lookup_network_error" }
  | { ok: false; reason: "pull_request_response_invalid" };

/** The shape a future orchestration/merge-execution slice depends on: `fetchImpl`/`mintCredential`
 * are bound once at composition time, `repository`/`pullRequestNumber` are passed per call. */
export type ObserveDeliveryPullRequest = (
  request: ObserveDeliveryPullRequestRequest,
) => Promise<ObserveDeliveryPullRequestOutcome>;

const pullRequestResponseSchema = z.object({
  number: z.number(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean(),
  merged: z.boolean(),
  mergeable: z.boolean().nullable(),
  head: z.object({
    sha: z.string(),
    ref: z.string(),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
  base: z.object({
    ref: z.string(),
    repo: z.object({ full_name: z.string() }),
  }),
});

/**
 * Observes the exact live GitHub Pull Request identified by `repository` + `pullRequestNumber` —
 * the durably persisted delivery PR identity, never a PR rediscovered by searching for a matching
 * branch. Reuses the existing GitHub App installation credential mint (`mintCredential`) and the
 * same raw-`fetch` request shape as `deliveryCiObservation.ts` / `adaPullRequest.ts`. Read-only: a
 * single GET against `/repos/{repository}/pulls/{number}`; this function does not wait, poll, or
 * retry — a caller wanting a fresher observation calls this again later.
 *
 * `mergeable` is returned exactly as GitHub reports it (`true` / `false` / `null` while GitHub is
 * still computing it) — the caller, not this primitive, decides how to treat each state. Never
 * returns response bodies/headers or the credential itself — only safe `httpStatus` values and
 * typed reasons, matching `githubAppCredential.ts` and `deliveryCiObservation.ts`.
 */
export async function observeDeliveryPullRequest(
  params: ObserveDeliveryPullRequestParams,
): Promise<ObserveDeliveryPullRequestOutcome> {
  const { repository, pullRequestNumber, fetchImpl, mintCredential } = params;

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

  let response: Response;
  try {
    response = await fetchImpl(`https://api.github.com/repos/${repository}/pulls/${pullRequestNumber}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    return { ok: false, reason: "pull_request_lookup_network_error" };
  }

  if (!response.ok) {
    return { ok: false, reason: "pull_request_lookup_failed", httpStatus: response.status };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "pull_request_response_invalid" };
  }

  const parsed = pullRequestResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, reason: "pull_request_response_invalid" };
  }
  const pr = parsed.data;

  return {
    ok: true,
    pullRequest: {
      number: pr.number,
      state: pr.state,
      merged: pr.merged,
      draft: pr.draft,
      headSha: pr.head.sha,
      headRef: pr.head.ref,
      headRepositoryFullName: pr.head.repo?.full_name ?? null,
      baseRef: pr.base.ref,
      baseRepositoryFullName: pr.base.repo.full_name,
      mergeable: pr.mergeable,
    },
  };
}
