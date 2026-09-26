import { z } from "zod";

import type { MintGithubDeliveryCredential, MintGithubDeliveryCredentialOutcome } from "./githubAppCredential";

type CredentialFailureReason = Exclude<MintGithubDeliveryCredentialOutcome, { ok: true }>["reason"];

/** The workflow that observation is anchored to — by file name, matching `.github/workflows/ci.yml`
 * directly, mirroring `deliveryCiObservation.ts`. */
const CI_WORKFLOW_FILE = "ci.yml";
const TERMINAL_STATUS = "completed";
const SUCCESS_CONCLUSION = "success";
const TRUSTED_EVENT = "pull_request";

/**
 * The exact structured identity `.github/workflows/ci.yml`'s `run-name` encodes for a `pull_request`
 * run, and the exact identity a caller expects one specific release Pull Request to be bound to.
 * Every field must originate from GitHub's own `pull_request` event context — never a PR title,
 * body, or other caller-supplied text.
 */
export interface ReleaseCiRunIdentity {
  prNumber: number;
  baseBranch: string;
  headBranch: string;
  headSha: string;
}

/**
 * `run-name` field is anchored front-to-back (`^...$`) with whitespace-delimited fields; git ref
 * names cannot contain whitespace, so no field can smuggle extra tokens past this pattern.
 */
const RELEASE_CI_RUN_NAME_PATTERN = /^ADA-RELEASE-CI pr=(\d+) base=(\S+) head=(\S+) sha=([0-9a-f]{40})$/;

/**
 * Parses `.github/workflows/ci.yml`'s deterministic `run-name` contract into a structured identity,
 * or `null` if the string does not exactly match the contract (a legacy pre-contract run, an
 * unrelated workflow's default title, or anything malformed). Never throws.
 */
export function parseReleaseCiRunIdentity(runName: string): ReleaseCiRunIdentity | null {
  const match = RELEASE_CI_RUN_NAME_PATTERN.exec(runName);
  if (!match) {
    return null;
  }
  const [, prNumber, baseBranch, headBranch, headSha] = match;
  return { prNumber: Number(prNumber), baseBranch, headBranch, headSha };
}

export interface ObserveReleaseCiStatusRequest {
  /** The immutable, already-validated `owner/repo` identity — never derived from workspace `origin`. */
  repository: string;
  /** The exact trusted identity this call is anchored to — supplied by the caller's own trust
   * anchor (see `releasePullRequestCiObservation.ts`), never independently re-derived here. */
  expectedIdentity: ReleaseCiRunIdentity;
}

export interface ObserveReleaseCiStatusParams extends ObserveReleaseCiStatusRequest {
  fetchImpl: typeof fetch;
  mintCredential: MintGithubDeliveryCredential;
}

export type ObserveReleaseCiStatusOutcome =
  | { ok: true; state: "pending" }
  | {
      /** Runs exist for `expectedIdentity.headSha`, but none carry a structured identity that binds
       * to `expectedIdentity` under this contract — e.g. a pre-contract legacy run, or a malformed
       * `run-name`. Distinct from `pending`: this SHA already has CI evidence, none of it trusted. */
      ok: true;
      state: "unbound";
    }
  | { ok: true; state: "succeeded"; runId: number; htmlUrl: string }
  | { ok: true; state: "failed"; runId: number; htmlUrl: string; conclusion: string }
  | { ok: false; reason: "credential_unavailable"; credentialReason: CredentialFailureReason; httpStatus?: number }
  | { ok: false; reason: "runs_lookup_failed"; httpStatus: number }
  | { ok: false; reason: "runs_lookup_network_error" }
  | { ok: false; reason: "malformed_response" };

/** The shape a future orchestration slice depends on: `fetchImpl`/`mintCredential` are bound once at
 * composition time, `repository`/`expectedIdentity` are passed per call. */
export type ObserveReleaseCiStatus = (
  request: ObserveReleaseCiStatusRequest,
) => Promise<ObserveReleaseCiStatusOutcome>;

const workflowRunSchema = z.object({
  id: z.number(),
  head_sha: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  html_url: z.string(),
  created_at: z.string(),
  event: z.string(),
  display_title: z.string(),
});

const workflowRunsResponseSchema = z.object({
  workflow_runs: z.array(workflowRunSchema),
});

type WorkflowRun = z.infer<typeof workflowRunSchema>;

/**
 * Deterministically selects the one authoritative run among several already proven to belong to
 * the intended PR identity (re-runs, repeated `pull_request` events): most recent `created_at`
 * wins; a tie breaks on the higher `id` (GitHub's ids are assigned in creation order). Never depends
 * on API response array order. Mirrors `deliveryCiObservation.ts`'s `pickAuthoritativeRun`.
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
 * Observes GitHub Actions CI for the exact `expectedIdentity` a caller already trusts (see
 * `releasePullRequestCiObservation.ts`) — never a run merely sharing `expectedIdentity.headSha`.
 * Reuses the existing GitHub App installation credential mint and the same raw-`fetch` request
 * shape as `deliveryCiObservation.ts`. Read-only: a single GET against the `ci.yml` workflow's runs,
 * filtered to `head_sha`; this function does not wait, poll, or retry.
 *
 * A run only ever enters the trusted candidate pool when **all** of the following hold: its own
 * `head_sha` field (never the `run-name` string) equals `expectedIdentity.headSha`; its `event` is
 * exactly `pull_request`; and its `display_title` parses via `parseReleaseCiRunIdentity` into an
 * identity that exactly equals `expectedIdentity` in every field. Two release PRs sharing a
 * repository/head branch/head SHA/workflow/event can therefore never be trusted for each other —
 * a run bound to PR #64 never satisfies PR #65's identity, regardless of its own outcome or
 * recency.
 *
 * If runs exist for `expectedIdentity.headSha` but none is a trusted candidate (every one failed to
 * parse, or parsed to a different identity), the result is `unbound` — distinct from `pending` — a
 * fail-closed signal that this SHA already carries CI evidence, none of it authoritatively bindable
 * to the caller's exact PR identity. Terminal outcomes among trusted candidates are conservative,
 * matching `deliveryCiObservation.ts`: only conclusion `"success"` is ever `succeeded`.
 */
export async function observeReleaseCiStatus(
  params: ObserveReleaseCiStatusParams,
): Promise<ObserveReleaseCiStatusOutcome> {
  const { repository, expectedIdentity, fetchImpl, mintCredential } = params;

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
  url.searchParams.set("head_sha", expectedIdentity.headSha);

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

  const runsForSha = parsed.data.workflow_runs.filter((run) => run.head_sha === expectedIdentity.headSha);

  const trustedCandidates = runsForSha.filter((run) => {
    if (run.event !== TRUSTED_EVENT) {
      return false;
    }
    const identity = parseReleaseCiRunIdentity(run.display_title);
    return (
      identity !== null &&
      identity.prNumber === expectedIdentity.prNumber &&
      identity.baseBranch === expectedIdentity.baseBranch &&
      identity.headBranch === expectedIdentity.headBranch &&
      identity.headSha === expectedIdentity.headSha
    );
  });

  if (trustedCandidates.length === 0) {
    const hasUnbindableEvidence = runsForSha.some(
      (run) => run.event === TRUSTED_EVENT && parseReleaseCiRunIdentity(run.display_title) === null,
    );
    return { ok: true, state: hasUnbindableEvidence ? "unbound" : "pending" };
  }

  const authoritative = pickAuthoritativeRun(trustedCandidates);
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
