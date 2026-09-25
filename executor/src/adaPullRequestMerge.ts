import { z } from "zod";

import type { MintGithubDeliveryCredential, MintGithubDeliveryCredentialOutcome } from "./githubAppCredential";

type CredentialFailureReason = Exclude<MintGithubDeliveryCredentialOutcome, { ok: true }>["reason"];

/** The only merge method this codebase currently applies — matches observed repository history
 * (merge-commit "Merge pull request #N from ..." messages) and is an explicit application-level
 * choice, not derived from GitHub's unspecified default. */
const ADA_MERGE_METHOD = "merge" as const;

export interface MergeAdaPullRequestRequest {
  /** The immutable, already-validated `owner/repo` identity — never derived from workspace `origin`. */
  repository: string;
  /** The durably persisted PR identity, taken only from a freshly-eligible `MergeEligibilityOutcome`. */
  pullRequestNumber: number;
  /** The verified ADA delivery commit SHA, sent as GitHub's own `sha` precondition on the merge
   * request. If the live PR head has moved since eligibility was checked, GitHub itself rejects the
   * merge (409) rather than this primitive silently merging a different commit. */
  expectedHeadSha: string;
}

export interface MergeAdaPullRequestParams extends MergeAdaPullRequestRequest {
  fetchImpl: typeof fetch;
  mintCredential: MintGithubDeliveryCredential;
}

export type MergeAdaPullRequestOutcome =
  | { ok: true; mergeCommitSha: string }
  | { ok: false; reason: "credential_unavailable"; credentialReason: CredentialFailureReason; httpStatus?: number }
  | { ok: false; reason: "pull_request_head_changed" }
  | { ok: false; reason: "not_mergeable" }
  | { ok: false; reason: "merge_permission_denied" }
  | { ok: false; reason: "merge_failed"; httpStatus: number }
  | { ok: false; reason: "merge_network_error" }
  | { ok: false; reason: "invalid_response" };

/** The shape a merge-execution orchestration depends on: `fetchImpl`/`mintCredential` are bound
 * once at composition time, the rest are passed per call. */
export type MergeAdaPullRequest = (request: MergeAdaPullRequestRequest) => Promise<MergeAdaPullRequestOutcome>;

const mergeResponseSchema = z.object({
  sha: z.string(),
  merged: z.boolean(),
});

/**
 * Performs one guarded `PUT /repos/{repository}/pulls/{pullRequestNumber}/merge` request — the
 * narrow GitHub mutation primitive underneath a merge-execution orchestration. Reuses the existing
 * GitHub App installation credential mint (`mintCredential`) and the same raw-`fetch` request shape
 * as `adaPullRequest.ts` / `deliveryPullRequestObservation.ts`.
 *
 * `expectedHeadSha` is always sent as the request body's `sha` field — GitHub's own documented
 * precondition — so a Pull Request head that has moved since the caller last checked eligibility
 * causes GitHub itself to reject the merge (409, mapped to `pull_request_head_changed`) rather than
 * this primitive merging a commit nobody just verified. No retry is attempted against a new head;
 * this function makes exactly one mutation attempt per call.
 *
 * Success is reported only when GitHub's response is syntactically valid *and* positively reports
 * `merged: true` — an HTTP-successful response with `merged: false`, or one that fails schema
 * validation, fails closed as `invalid_response` rather than being treated as success. Never returns
 * response bodies/headers or the credential itself — only safe `httpStatus` values and typed
 * reasons, matching `githubAppCredential.ts` and `adaPullRequest.ts`.
 */
export async function mergeAdaPullRequest(params: MergeAdaPullRequestParams): Promise<MergeAdaPullRequestOutcome> {
  const { repository, pullRequestNumber, expectedHeadSha, fetchImpl, mintCredential } = params;

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
    response = await fetchImpl(`https://api.github.com/repos/${repository}/pulls/${pullRequestNumber}/merge`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ merge_method: ADA_MERGE_METHOD, sha: expectedHeadSha }),
    });
  } catch {
    return { ok: false, reason: "merge_network_error" };
  }

  if (!response.ok) {
    if (response.status === 409) {
      return { ok: false, reason: "pull_request_head_changed" };
    }
    if (response.status === 405) {
      return { ok: false, reason: "not_mergeable" };
    }
    if (response.status === 403) {
      return { ok: false, reason: "merge_permission_denied" };
    }
    return { ok: false, reason: "merge_failed", httpStatus: response.status };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "invalid_response" };
  }

  const parsed = mergeResponseSchema.safeParse(body);
  if (!parsed.success || !parsed.data.merged) {
    return { ok: false, reason: "invalid_response" };
  }

  return { ok: true, mergeCommitSha: parsed.data.sha };
}
