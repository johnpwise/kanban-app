import { execFile } from "node:child_process";

/** Bounds every git invocation so a stalled network clone/checkout fails safely instead of hanging the job indefinitely. */
const GIT_COMMAND_TIMEOUT_MS = 120_000;

export type RunGitOutcome = { ok: true; stdout: string } | { ok: false; stderr: string; code: number | string | null };

export interface RunGitParams {
  args: string[];
  cwd?: string;
  /**
   * Opt-in override for the child process's env. Omitted (the default, used by every existing
   * call site): the ambient `process.env` is passed through, unchanged from today. Provided: this
   * exact object is used instead — the ambient env is never merged in. This lets one narrowly
   * scoped call (e.g. an authenticated push) receive a minimal, explicitly-built env carrying a
   * credential, without widening what every other `runGit` call inherits.
   */
  env?: NodeJS.ProcessEnv;
}

/** Injectable seam: repository-workspace materialisation depends on this type, not on `execFile` directly. */
export type RunGit = (params: RunGitParams) => Promise<RunGitOutcome>;

/**
 * Runs `git` via `execFile` with an explicit argv array — never a shell string, so values in
 * `args` cannot reach shell interpretation. Every invocation disables the credential-helper lookup
 * and interactive credential prompting so an authenticated/private repository fails fast
 * (`ok: false`) instead of hanging on a prompt or silently succeeding via an ambient credential
 * this package never introduces. Never throws and never logs — structured failure is the caller's
 * signal, and filtering what's safe to log is the caller's responsibility.
 */
export const runGit: RunGit = ({ args, cwd, env }) =>
  new Promise((resolve) => {
    execFile(
      "git",
      ["-c", "credential.helper=", ...args],
      { cwd, env: { ...(env ?? process.env), GIT_TERMINAL_PROMPT: "0" }, timeout: GIT_COMMAND_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, stderr, code: error.code ?? null });
          return;
        }
        resolve({ ok: true, stdout });
      },
    );
  });
