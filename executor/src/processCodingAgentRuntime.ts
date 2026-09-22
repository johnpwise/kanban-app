import { execFile } from "node:child_process";

import type { CodingAgentInvocation, InvokeCodingAgent } from "./codingAgentInvocation";

export type ProcessCodingAgentRuntimeFailureKind = "spawn_failed" | "non_zero_exit" | "timeout" | "adapter_error";

/**
 * Thrown by `createProcessInvokeCodingAgent` for every failure mode. The message is built only from
 * safe, non-content values (exit codes, signal names, elapsed timeout) — never stdout, stderr, or
 * the invocation's task title/prompt — so it is safe for a caller to log or let propagate.
 */
export class ProcessCodingAgentRuntimeError extends Error {
  readonly kind: ProcessCodingAgentRuntimeFailureKind;

  constructor(kind: ProcessCodingAgentRuntimeFailureKind, message: string) {
    super(message);
    this.name = "ProcessCodingAgentRuntimeError";
    this.kind = kind;
  }
}

export interface SpawnCodingAgentProcessParams {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
  stdinPayload: string;
}

export type SpawnCodingAgentProcessOutcome =
  | { ok: true }
  | { ok: false; kind: "non_zero_exit"; exitCode: number }
  | { ok: false; kind: "timeout"; signal: string | null }
  | { ok: false; kind: "spawn_failed"; code: string | null };

/** Injectable seam: `createProcessInvokeCodingAgent` depends on this type, not on `execFile` directly. */
export type SpawnCodingAgentProcess = (params: SpawnCodingAgentProcessParams) => Promise<SpawnCodingAgentProcessOutcome>;

/**
 * Runs an arbitrary executable via `execFile` with an explicit argv array — never a shell string —
 * so nothing in `args` or the task payload can reach shell interpretation. The task payload is
 * written to the child's stdin (never argv, never an env var, never logged) and stdin is closed
 * immediately after, so a process reading to EOF observes the complete payload. Bounded by
 * `timeoutMs`; a process that exceeds it is killed. Never throws and never logs — structured
 * failure is the caller's signal, and filtering what's safe to log is the caller's responsibility.
 */
export const spawnCodingAgentProcess: SpawnCodingAgentProcess = ({ command, args, cwd, timeoutMs, env, stdinPayload }) =>
  new Promise((resolve) => {
    const child = execFile(command, args, { cwd, env, timeout: timeoutMs }, (error) => {
      if (!error) {
        resolve({ ok: true });
        return;
      }
      if (error.killed) {
        resolve({ ok: false, kind: "timeout", signal: error.signal ?? null });
        return;
      }
      if (typeof error.code === "number") {
        resolve({ ok: false, kind: "non_zero_exit", exitCode: error.code });
        return;
      }
      resolve({ ok: false, kind: "spawn_failed", code: typeof error.code === "string" ? error.code : null });
    });

    // Unlike `runGit` (executor/gitProcess.ts), `command` here is caller-supplied, not the
    // always-present `git` binary — a missing/unreadable executable is a real, expected case for
    // this seam. `execFile`'s callback already reports it, but this backstops the child's own
    // `error` event so a spawn failure can never surface as an unhandled 'error' and crash the job.
    child.once("error", (spawnError: NodeJS.ErrnoException) => {
      resolve({ ok: false, kind: "spawn_failed", code: spawnError.code ?? null });
    });

    child.stdin?.end(stdinPayload);
  });

export interface ProcessCodingAgentRuntimeConfig {
  /** The executable to run — never a shell string. */
  command: string;
  args?: string[];
  /** Bounds the process so a stalled coding-agent run cannot hang the Cloud Run Job indefinitely. */
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
}

function buildStdinPayload(invocation: CodingAgentInvocation): string {
  return JSON.stringify({ title: invocation.task.title, prompt: invocation.task.prompt });
}

/**
 * The provider-neutral process-execution runtime adapter: an `InvokeCodingAgent` implementation
 * that runs `config.command` against the already-materialised workspace as `cwd`. Every failure
 * mode (non-zero exit, startup/spawn failure, timeout, or an unexpected adapter-level failure)
 * converts to a thrown `ProcessCodingAgentRuntimeError`, which `runExecutor`'s existing generic
 * catch already turns into a safe `coding_agent_invocation_error` outcome — no caller change
 * required. `spawn` is an injectable seam (defaults to `spawnCodingAgentProcess`) for testing.
 */
export function createProcessInvokeCodingAgent(
  config: ProcessCodingAgentRuntimeConfig,
  spawn: SpawnCodingAgentProcess = spawnCodingAgentProcess,
): InvokeCodingAgent {
  return async (invocation) => {
    let outcome: SpawnCodingAgentProcessOutcome;
    try {
      outcome = await spawn({
        command: config.command,
        args: config.args ?? [],
        cwd: invocation.workspace.path,
        timeoutMs: config.timeoutMs,
        env: config.env ?? process.env,
        stdinPayload: buildStdinPayload(invocation),
      });
    } catch {
      throw new ProcessCodingAgentRuntimeError("adapter_error", "Unexpected failure while executing the coding-agent process.");
    }

    if (outcome.ok) {
      return;
    }

    switch (outcome.kind) {
      case "non_zero_exit":
        throw new ProcessCodingAgentRuntimeError("non_zero_exit", `Coding-agent process exited with code ${outcome.exitCode}.`);
      case "timeout":
        throw new ProcessCodingAgentRuntimeError(
          "timeout",
          `Coding-agent process was terminated after exceeding the ${config.timeoutMs}ms timeout.`,
        );
      case "spawn_failed":
        throw new ProcessCodingAgentRuntimeError(
          "spawn_failed",
          `Coding-agent process failed to start (${outcome.code ?? "unknown error"}).`,
        );
    }
  };
}
