import { z } from "zod";

import type { MintGithubDeliveryCredential, MintGithubDeliveryCredentialOutcome } from "./githubAppCredential";

type CredentialFailureReason = Exclude<MintGithubDeliveryCredentialOutcome, { ok: true }>["reason"];

/** The workflow that observation is anchored to — referenced by file name, not a numeric id, so
 * it matches `.github/workflows/ci.yml` directly rather than requiring a prior id lookup. */
const CI_WORKFLOW_FILE = "ci.yml";
const TERMINAL_STATUS = "completed";
const SUCCESS_CONCLUSION = "success";

export interface ObserveDeliveryCiStatusRequest {
  /** The immutable, already-validated `owner/repo` identity — never derived from workspace `origin`. */
  repository: string;
  /** The verified ADA delivery commit SHA — the only value CI observation is trusted to be anchored to. */
  deliveryCommitSha: string;
}

export interface ObserveDeliveryCiStatusParams extends ObserveDeliveryCiStatusRequest {
  fetchImpl: typeof fetch;
  mintCredential: MintGithubDeliveryCredential;
}

export type ObserveDeliveryCiStatusOutcome =
  | { ok: true; state: "pending" }
  | { ok: true; state: "succeeded"; runId: number; htmlUrl: string }
  | { ok: true; state: "failed"; runId: number; htmlUrl: string; conclusion: string }
  | { ok: false; reason: "credential_unavailable"; credentialReason: CredentialFailureReason; httpStatus?: number }
  | { ok: false; reason: "runs_lookup_failed"; httpStatus: number }
  | { ok: false; reason: "runs_lookup_network_error" }
  | { ok: false; reason: "malformed_response" };

/** The shape a future orchestration slice depends on: `fetchImpl`/`mintCredential` are bound once at
 * composition time, `repository`/`deliveryCommitSha` are passed per call. Not wired into
 * `runExecutor` in this slice — this is a standalone, repeatable read/observe primitive only. */
export type ObserveDeliveryCiStatus = (
  request: ObserveDeliveryCiStatusRequest,
) => Promise<ObserveDeliveryCiStatusOutcome>;

const workflowRunSchema = z.object({
  id: z.number(),
  head_sha: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  html_url: z.string(),
  created_at: z.string(),
});

const workflowRunsResponseSchema = z.object({
  workflow_runs: z.array(workflowRunSchema),
});

type WorkflowRun = z.infer<typeof workflowRunSchema>;

/**
 * Deterministically selects the one authoritative run among several matching a commit (re-runs,
 * repeated `pull_request` events): most recent `created_at` wins; a tie breaks on the higher `id`
 * (GitHub's ids are assigned in creation order). Never depends on API response array order.
 */
function pickAuthoritativeRun(runs: WorkflowRun[]): WorkflowRun {
  return [...runs].sort((a, b) => {
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? 1 : -1;
    }
    return b.id - a.id;
  })[0];
}

/**
 * Observes GitHub Actions CI for the exact `deliveryCommitSha` already verified and pushed by ADA
 * (see `deliveryPush.ts`) — never the branch HEAD, the PR, or the latest repository run. Reuses the
 * existing GitHub App installation credential mint (`mintCredential`) and the same raw-`fetch`
 * request shape as `adaPullRequest.ts`. Read-only: a single GET against the `ci.yml` workflow's
 * runs, filtered to `head_sha`; this function does not wait, poll, or retry — a caller wanting
 * repeated observation calls this again later.
 *
 * Every matching run is re-checked against `deliveryCommitSha` after parsing (defense in depth: a
 * run is never trusted on the strength of the request's `head_sha` query param alone). Terminal
 * outcomes are conservative: any completed run whose conclusion isn't exactly `"success"` —
 * including `cancelled`, `timed_out`, `action_required`, `neutral`, `stale`, `skipped`, or a missing
 * conclusion — classifies as `failed`, never `succeeded` or `pending`. Never returns response
 * bodies/headers or the credential itself — only safe `httpStatus` values and typed reasons,
 * matching `githubAppCredential.ts` and `adaPullRequest.ts`.
 */
export async function observeDeliveryCiStatus(
  params: ObserveDeliveryCiStatusParams,
): Promise<ObserveDeliveryCiStatusOutcome> {
  const { repository, deliveryCommitSha, fetchImpl, mintCredential } = params;

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

  const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/${CI_WORKFLOW_FILE}/runs`);
  url.searchParams.set("head_sha", deliveryCommitSha);

  let response: Response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch {
    return { ok: false, reason: "runs_lookup_network_error" };
  }

  if (!response.ok) {
    return { ok: false, reason: "runs_lookup_failed", httpStatus: response.status };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "malformed_response" };
  }

  const parsed = workflowRunsResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, reason: "malformed_response" };
  }

  const matchingRuns = parsed.data.workflow_runs.filter((run) => run.head_sha === deliveryCommitSha);
  if (matchingRuns.length === 0) {
    return { ok: true, state: "pending" };
  }

  const authoritative = pickAuthoritativeRun(matchingRuns);
  if (authoritative.status !== TERMINAL_STATUS) {
    return { ok: true, state: "pending" };
  }
  if (authoritative.conclusion === SUCCESS_CONCLUSION) {
    return { ok: true, state: "succeeded", runId: authoritative.id, htmlUrl: authoritative.html_url };
  }
  return {
    ok: true,
    state: "failed",
    runId: authoritative.id,
    htmlUrl: authoritative.html_url,
    conclusion: authoritative.conclusion ?? "unknown",
  };
}
