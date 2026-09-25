import { z } from "zod";

const DEFAULT_COMMAND = "codex";
const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * `--ask-for-approval` is a top-level `codex` flag (`codex --ask-for-approval <policy> exec ...`),
 * not an option of the `exec` subcommand — passed after `exec` it is an unrecognized argument and
 * the CLI's arg parser rejects it (usage error). `never` (not a "full access"/"bypass" flag) is the
 * constrained unattended mode this feature requires: it runs inside the already-sandboxed,
 * disposable materialised workspace without prompting for interactive approval, but stays within
 * `workspace-write`.
 */
const CODEX_BASE_ARGS = ["--ask-for-approval", "never", "exec", "-", "--sandbox", "workspace-write"] as const;

const CODEX_REASONING_EFFORT_VALUES = ["low", "medium", "high", "xhigh", "max"] as const;

const codexProviderEnvSchema = z.object({
  CODEX_API_KEY: z.string().trim().min(1, "CODEX_API_KEY is required."),
  CODEX_COMMAND: z.string().trim().min(1).optional(),
  // Required (not optional): an unset model must fail closed at config validation instead of
  // silently falling back to whatever model the Codex CLI itself defaults to.
  CODEX_MODEL: z.string().trim().min(1, "CODEX_MODEL is required."),
  CODEX_REASONING_EFFORT: z.enum(CODEX_REASONING_EFFORT_VALUES).optional(),
  CODEX_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) {
        return DEFAULT_TIMEOUT_MS;
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        ctx.addIssue({ code: "custom", message: "CODEX_TIMEOUT_MS must be a positive integer." });
        return z.NEVER;
      }
      return parsed;
    }),
});

export interface CodexProviderConfig {
  /** The executable to run — never a shell string. */
  command: string;
  args: string[];
  timeoutMs: number;
  /**
   * A minimal, explicitly-built child-process env — never `process.env` passed through — so the
   * sandboxed Codex process (running against a materialised, attacker-influenced repository) never
   * inherits the executor's broader environment or any unrelated secret.
   */
  env: NodeJS.ProcessEnv;
}

/**
 * Builds the constrained, unattended Codex CLI invocation config from the runtime environment.
 * `CODEX_API_KEY` is read once here and never logged: it is only ever placed into the returned
 * `env` object, which callers must pass to a child process, not to a logger.
 */
export function parseCodexProviderConfig(env: Record<string, string | undefined>): CodexProviderConfig {
  const parsed = codexProviderEnvSchema.parse({
    CODEX_API_KEY: env.CODEX_API_KEY,
    CODEX_COMMAND: env.CODEX_COMMAND,
    CODEX_MODEL: env.CODEX_MODEL,
    CODEX_REASONING_EFFORT: env.CODEX_REASONING_EFFORT,
    CODEX_TIMEOUT_MS: env.CODEX_TIMEOUT_MS,
  });

  const args = [...CODEX_BASE_ARGS, "--model", parsed.CODEX_MODEL];
  if (parsed.CODEX_REASONING_EFFORT) {
    args.push("-c", `model_reasoning_effort=${parsed.CODEX_REASONING_EFFORT}`);
  }

  return {
    command: parsed.CODEX_COMMAND ?? DEFAULT_COMMAND,
    args,
    timeoutMs: parsed.CODEX_TIMEOUT_MS,
    env: {
      CODEX_API_KEY: parsed.CODEX_API_KEY,
      PATH: env.PATH,
      HOME: env.HOME,
    },
  };
}
