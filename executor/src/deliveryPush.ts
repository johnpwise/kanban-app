import { createGitAskpassScript, removeGitAskpassScript } from "./gitAskpassHelper";

import type { MintGithubDeliveryCredential, MintGithubDeliveryCredentialOutcome } from "./githubAppCredential";
import type { RunGit } from "./gitProcess";

/**
 * Builds the push destination from the immutable, already-validated `owner/repo` identity —
 * mirrors `repositoryWorkspace.ts`'s clone-URL derivation by design. Never reads the workspace's
 * configured `origin`: the cloned repository's `.git` config is attacker-influenced and must not
 * be trusted to choose where an authenticated credential is sent.
 */
export function buildDeliveryPushUrl(repository: string): string {
  return `https://github.com/${repository}.git`;
}

type CredentialFailureReason = Exclude<MintGithubDeliveryCredentialOutcome, { ok: true }>["reason"];

export interface EnsureAdaDeliveryPushRequest {
  /** The still-live materialised workspace path, holding the verified ADA delivery commit. */
  workspacePath: string;
  /** The immutable, already-validated `owner/repo` identity — the only input to the push destination. */
  repository: string;
  /** The verified ADA delivery branch name (e.g. `ada/<executionRequestId>`). */
  deliveryBranch: string;
  /** The verified local delivery commit SHA — pushed by exact value, never implicit workspace state. */
  deliveryCommitSha: string;
}

export type EnsureAdaDeliveryPushOutcome =
  | { ok: true; remoteBranch: string; remoteSha: string }
  | { ok: false; reason: "credential_unavailable"; credentialReason: CredentialFailureReason; httpStatus?: number }
  | { ok: false; reason: "askpass_setup_failed" }
  | {
      ok: false;
      reason: "push_failed";
      /** The failing git command's exit code or spawn error code — never stderr. Safe to log.
       * Covers both an ordinary push failure and a rejected non-fast-forward (divergent remote):
       * git's default (no `--force`) already refuses to overwrite divergent history, which is the
       * required "fail safely on divergence" behaviour — this module never inspects stderr to
       * distinguish the two, consistent with every other composed step in this pipeline. */
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

export interface EnsureAdaDeliveryPushParams extends EnsureAdaDeliveryPushRequest {
  /** Supplies `PATH`/`HOME` for the scoped push/verify env — never read from `process.env` directly here. */
  env: Record<string, string | undefined>;
  runGit: RunGit;
  mintCredential: MintGithubDeliveryCredential;
}

/** The shape `runExecutor` depends on: `env`/`runGit`/`mintCredential` are bound once at composition time (see `main.ts`), not per call. */
export type EnsureAdaDeliveryPush = (request: EnsureAdaDeliveryPushRequest) => Promise<EnsureAdaDeliveryPushOutcome>;

function parseLsRemoteSha(stdout: string): string | null {
  const firstLine = stdout.trim().split("\n")[0] ?? "";
  const sha = firstLine.split(/\s+/)[0];
  return sha ? sha : null;
}

/**
 * Publishes the verified local ADA delivery commit to GitHub and independently confirms it landed
 * — the single composed step `runExecutor` invokes once the local delivery commit is created and
 * verified, before workspace cleanup. Mints a short-lived, isolated GitHub App installation
 * credential; supplies it to `git` only via a per-call `GIT_ASKPASS` script and a scoped child
 * env (never argv, never the remote URL, never persisted) so it can never reach the coding-agent
 * process or leak through logs; pushes the exact `deliveryCommitSha` (never `--force`); and
 * resolves `refs/heads/<deliveryBranch>` with a fresh `ls-remote` rather than trusting the push's
 * own exit code.
 */
export async function ensureAdaDeliveryPush({
  workspacePath,
  repository,
  deliveryBranch,
  deliveryCommitSha,
  env,
  runGit,
  mintCredential,
}: EnsureAdaDeliveryPushParams): Promise<EnsureAdaDeliveryPushOutcome> {
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
    const url = buildDeliveryPushUrl(repository);

    const pushOutcome = await runGit({
      args: ["push", "--no-verify", url, `${deliveryCommitSha}:refs/heads/${deliveryBranch}`],
      cwd: workspacePath,
      env: scopedEnv,
    });
    if (!pushOutcome.ok) {
      return { ok: false, reason: "push_failed", gitErrorCode: pushOutcome.code };
    }

    const lsRemoteOutcome = await runGit({
      args: ["ls-remote", url, `refs/heads/${deliveryBranch}`],
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
    if (remoteSha !== deliveryCommitSha) {
      return { ok: false, reason: "remote_sha_mismatch", expectedSha: deliveryCommitSha, actualSha: remoteSha };
    }

    return { ok: true, remoteBranch: deliveryBranch, remoteSha };
  } finally {
    await removeGitAskpassScript(askpassOutcome.scriptPath);
  }
}
