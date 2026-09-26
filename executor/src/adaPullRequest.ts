import { createOrReuseGithubPullRequest } from "./githubPullRequest";

import type { MintGithubDeliveryCredential, MintGithubDeliveryCredentialOutcome } from "./githubAppCredential";

type CredentialFailureReason = Exclude<MintGithubDeliveryCredentialOutcome, { ok: true }>["reason"];

const ADA_PULL_REQUEST_TITLE_FALLBACK_PREFIX = "ADA delivery:";

export interface CreateOrReuseAdaPullRequestRequest {
  /** The immutable, already-validated `owner/repo` identity — never derived from workspace `origin`. */
  repository: string;
  /** The verified ADA delivery branch (e.g. `ada/<executionRequestId>`) — the PR's head ref. */
  head: string;
  /** The immutable requested base branch from trusted Execution Request data — the PR's base ref. */
  base: string;
  executionRequestId: string;
  /** The verified local delivery commit SHA, included only as safe metadata in the PR body. */
  deliveryCommitSha: string;
  /** The resolved, already-fallback-applied PR title (see `buildAdaPullRequestTitle`). */
  title: string;
}

export interface CreateOrReuseAdaPullRequestParams extends CreateOrReuseAdaPullRequestRequest {
  fetchImpl: typeof fetch;
  mintCredential: MintGithubDeliveryCredential;
}

export type CreateOrReuseAdaPullRequestOutcome =
  | { ok: true; status: "created"; number: number; htmlUrl: string }
  | { ok: true; status: "existing"; number: number; htmlUrl: string }
  | { ok: false; reason: "credential_unavailable"; credentialReason: CredentialFailureReason; httpStatus?: number }
  | { ok: false; reason: "lookup_failed"; httpStatus: number }
  | { ok: false; reason: "lookup_network_error" }
  | { ok: false; reason: "create_failed"; httpStatus: number }
  | { ok: false; reason: "create_network_error" };

/** The shape `runExecutor` depends on: `fetchImpl`/`mintCredential` are bound once at composition time (see `main.ts`), not per call. */
export type CreateOrReuseAdaPullRequest = (
  request: CreateOrReuseAdaPullRequestRequest,
) => Promise<CreateOrReuseAdaPullRequestOutcome>;

/**
 * Resolves the deterministic, ADA-controlled PR title. `runTitle` is `run.input.title` — already a
 * trusted field (min-length-validated by the execution-run schema and already used unescaped as
 * the coding-agent task title) — but this still defends against a blank/whitespace-only value with
 * a fixed ADA-owned fallback, so repository-controlled content can never produce an empty title.
 */
export function buildAdaPullRequestTitle(runTitle: string, executionRequestId: string): string {
  const trimmed = runTitle.trim();
  return trimmed.length > 0 ? runTitle : `${ADA_PULL_REQUEST_TITLE_FALLBACK_PREFIX} ${executionRequestId}`;
}

function buildAdaPullRequestBody(params: { executionRequestId: string; deliveryCommitSha: string; base: string }): string {
  return [
    "Created by ADA.",
    "",
    `- Execution request: ${params.executionRequestId}`,
    `- Delivery commit: ${params.deliveryCommitSha}`,
    `- Base revision: ${params.base}`,
  ].join("\n");
}

/**
 * Creates (or idempotently reuses) the GitHub Pull Request for a verified ADA delivery branch —
 * invoked only after `remoteDelivery.status === "verified"`. Delegates the generic
 * create/reuse/422-race/credential mechanics to `githubPullRequest.ts`'s
 * `createOrReuseGithubPullRequest`; this module retains only the delivery-domain title/body
 * building and request/outcome shapes (`executionRequestId`, `deliveryCommitSha`) so callers of
 * this function see no behavior change from the extraction.
 */
export async function createOrReuseAdaPullRequest(
  params: CreateOrReuseAdaPullRequestParams,
): Promise<CreateOrReuseAdaPullRequestOutcome> {
  const { repository, head, base, executionRequestId, deliveryCommitSha, title, fetchImpl, mintCredential } = params;

  return createOrReuseGithubPullRequest({
    repository,
    head,
    base,
    title,
    body: buildAdaPullRequestBody({ executionRequestId, deliveryCommitSha, base }),
    fetchImpl,
    mintCredential,
  });
}
