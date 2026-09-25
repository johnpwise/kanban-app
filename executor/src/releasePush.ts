import { pushVerifiedCommitToBranch } from "./gitPushOperations";

import type { MintGithubDeliveryCredential, MintGithubDeliveryCredentialOutcome } from "./githubAppCredential";
import type { RunGit } from "./gitProcess";

/**
 * Builds the push destination from the exact trusted `repository` — never reads the workspace's
 * configured `origin`, which is attacker-influenced. Mirrors `deliveryPush.ts`'s
 * `buildDeliveryPushUrl` by design.
 */
export function buildReleasePushUrl(repository: string): string {
  return `https://github.com/${repository}.git`;
}

type CredentialFailureReason = Exclude<MintGithubDeliveryCredentialOutcome, { ok: true }>["reason"];

export interface EnsureReleaseStartPushRequest {
  /** The still-live materialised workspace path, holding the verified release-start commit. */
  workspacePath: string;
  /** The exact trusted `repository` from a fresh eligibility result — the only input to the push destination. */
  repository: string;
  /** The verified `release/<version>` branch name. */
  releaseBranch: string;
  /** The verified local release-start commit SHA — pushed by exact value, never implicit workspace state. */
  releaseCommitSha: string;
}

export type EnsureReleaseStartPushOutcome =
  | { ok: true; remoteBranch: string; remoteSha: string }
  | { ok: false; reason: "credential_unavailable"; credentialReason: CredentialFailureReason; httpStatus?: number }
  | { ok: false; reason: "askpass_setup_failed" }
  | {
      ok: false;
      reason: "push_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    }
  | {
      ok: false;
      reason: "remote_verification_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log. */
      gitErrorCode: number | string | null;
    }
  | { ok: false; reason: "remote_ref_not_found" }
  | {
      ok: false;
      reason: "remote_sha_mismatch";
      /** Safe git identifiers only. */
      expectedSha: string;
      actualSha: string;
    };

export interface EnsureReleaseStartPushParams extends EnsureReleaseStartPushRequest {
  /** Supplies `PATH`/`HOME` for the scoped push/verify env — never read from `process.env` directly here. */
  env: Record<string, string | undefined>;
  runGit: RunGit;
  mintCredential: MintGithubDeliveryCredential;
}

/** The shape a future composition root depends on: `env`/`runGit`/`mintCredential` bound once, not per call. */
export type EnsureReleaseStartPush = (request: EnsureReleaseStartPushRequest) => Promise<EnsureReleaseStartPushOutcome>;

/**
 * Publishes the verified local release-start commit to GitHub and independently confirms it landed
 * — the release-domain counterpart of `ensureAdaDeliveryPush`, sharing the same hardened
 * credential/ASKPASS/exact-SHA/non-force push boundary via `pushVerifiedCommitToBranch`.
 */
export async function ensureReleaseStartPush({
  workspacePath,
  repository,
  releaseBranch,
  releaseCommitSha,
  env,
  runGit,
  mintCredential,
}: EnsureReleaseStartPushParams): Promise<EnsureReleaseStartPushOutcome> {
  return pushVerifiedCommitToBranch({
    workspacePath,
    repository,
    pushUrl: buildReleasePushUrl(repository),
    branchName: releaseBranch,
    commitSha: releaseCommitSha,
    env,
    runGit,
    mintCredential,
  });
}
