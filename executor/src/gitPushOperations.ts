import { createGitAskpassScript, removeGitAskpassScript } from "./gitAskpassHelper";

import type { MintGithubDeliveryCredential, MintGithubDeliveryCredentialOutcome } from "./githubAppCredential";
import type { RunGit } from "./gitProcess";

type CredentialFailureReason = Exclude<MintGithubDeliveryCredentialOutcome, { ok: true }>["reason"];

export interface PushVerifiedCommitRequest {
  /** The still-live materialised workspace path, holding the verified local commit to publish. */
  workspacePath: string;
  /** The immutable, already-validated `owner/repo` identity — the only input to credential scoping. */
  repository: string;
  /** The push destination URL — derived by the caller from `repository` alone, never the
   * workspace's configured `origin`, which is attacker-influenced. */
  pushUrl: string;
  /** The branch ref to publish to (e.g. `ada/<executionRequestId>` or `release/<version>`). */
  branchName: string;
  /** The verified local commit SHA — pushed by exact value, never implicit `HEAD`. */
  commitSha: string;
}

export type PushVerifiedCommitOutcome =
  | { ok: true; remoteBranch: string; remoteSha: string }
  | { ok: false; reason: "credential_unavailable"; credentialReason: CredentialFailureReason; httpStatus?: number }
  | { ok: false; reason: "askpass_setup_failed" }
  | {
      ok: false;
      reason: "push_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log.
       * Covers both an ordinary push failure and a rejected non-fast-forward (divergent remote):
       * git's default (no `--force`) already refuses to overwrite divergent history. */
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

export interface PushVerifiedCommitParams extends PushVerifiedCommitRequest {
  /** Supplies `PATH`/`HOME` for the scoped push/verify env — never read from `process.env` directly here. */
  env: Record<string, string | undefined>;
  runGit: RunGit;
  mintCredential: MintGithubDeliveryCredential;
}

function parseLsRemoteSha(stdout: string): string | null {
  const firstLine = stdout.trim().split("\n")[0] ?? "";
  const sha = firstLine.split(/\s+/)[0];
  return sha ? sha : null;
}

/**
 * Publishes an already-verified local commit to GitHub and independently confirms it landed —
 * domain-neutral: used both for the ADA delivery push and the release-start push, each supplying
 * its own `pushUrl`/`branchName`/`commitSha`. Mints a short-lived, isolated GitHub App installation
 * credential; supplies it to `git` only via a per-call `GIT_ASKPASS` script and a scoped child env
 * (never argv, never the remote URL, never persisted) so it can never reach the coding-agent
 * process or leak through logs; pushes the exact `commitSha` (never `--force`); and resolves
 * `refs/heads/<branchName>` with a fresh `ls-remote` rather than trusting the push's own exit code.
 */
export async function pushVerifiedCommitToBranch({
  workspacePath,
  repository,
  pushUrl,
  branchName,
  commitSha,
  env,
  runGit,
  mintCredential,
}: PushVerifiedCommitParams): Promise<PushVerifiedCommitOutcome> {
  const credentialOutcome = await mintCredential({ repository });
  if (!credentialOutcome.ok) {
    return {
      ok: false,
      reason: "credential_unavailable",
      credentialReason: credentialOutcome.reason,
      ...("httpStatus" in credentialOutcome ? { httpStatus: credentialOutcome.httpStatus } : {}),
    };
  }

  const askpassOutcome = await createGitAskpassScript();
  if (!askpassOutcome.ok) {
    return { ok: false, reason: "askpass_setup_failed" };
  }

  try {
    const scopedEnv: NodeJS.ProcessEnv = {
      PATH: env.PATH,
      HOME: env.HOME,
      GIT_ASKPASS: askpassOutcome.scriptPath,
      ADA_GIT_ASKPASS_TOKEN: credentialOutcome.token,
    };

    const pushOutcome = await runGit({
      args: ["push", "--no-verify", pushUrl, `${commitSha}:refs/heads/${branchName}`],
      cwd: workspacePath,
      env: scopedEnv,
    });
    if (!pushOutcome.ok) {
      return { ok: false, reason: "push_failed", gitErrorCode: pushOutcome.code };
    }

    const lsRemoteOutcome = await runGit({
      args: ["ls-remote", pushUrl, `refs/heads/${branchName}`],
      cwd: workspacePath,
      env: scopedEnv,
    });
    if (!lsRemoteOutcome.ok) {
      return { ok: false, reason: "remote_verification_failed", gitErrorCode: lsRemoteOutcome.code };
    }

    const remoteSha = parseLsRemoteSha(lsRemoteOutcome.stdout);
    if (!remoteSha) {
      return { ok: false, reason: "remote_ref_not_found" };
    }
    if (remoteSha !== commitSha) {
      return { ok: false, reason: "remote_sha_mismatch", expectedSha: commitSha, actualSha: remoteSha };
    }

    return { ok: true, remoteBranch: branchName, remoteSha };
  } finally {
    await removeGitAskpassScript(askpassOutcome.scriptPath);
  }
}
