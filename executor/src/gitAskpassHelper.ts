import { randomBytes } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Implements git's `GIT_ASKPASS` protocol: git invokes this script with the prompt text as its
 * only argument and reads the answer from stdout. Never receives the credential as an argument —
 * it reads it from `ADA_GIT_ASKPASS_TOKEN`, an env var scoped to this one child process by the
 * caller (via `runGit`'s opt-in `env` override), never the ambient environment. A missing token
 * env var yields an empty answer rather than throwing, so a mis-wired call fails the git operation
 * (bad credentials) instead of crashing the helper.
 */
const ASKPASS_SCRIPT_SOURCE = `#!/usr/bin/env node
const prompt = process.argv[2] || "";
const token = process.env.ADA_GIT_ASKPASS_TOKEN || "";
process.stdout.write(/username/i.test(prompt) ? "x-access-token" : token);
`;

export type CreateGitAskpassScriptOutcome = { ok: true; scriptPath: string } | { ok: false; reason: "write_failed" };

export interface CreateGitAskpassScriptParams {
  /** Defaults to the OS temp directory. Overridable only so tests can use an isolated fixture directory. */
  directory?: string;
}

/**
 * Writes a fresh, uniquely-named, owner-only-executable askpass script for one push operation.
 * The script contains no secret — it only knows how to read one from its own process env — so
 * writing it to disk never persists credential material in the workspace.
 */
export async function createGitAskpassScript({
  directory = tmpdir(),
}: CreateGitAskpassScriptParams = {}): Promise<CreateGitAskpassScriptOutcome> {
  const scriptPath = join(directory, `ada-git-askpass-${randomBytes(8).toString("hex")}.mjs`);
  try {
    await writeFile(scriptPath, ASKPASS_SCRIPT_SOURCE, { mode: 0o700 });
    return { ok: true, scriptPath };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
}

/** Best-effort cleanup — safe to call even if the script was already removed. */
export async function removeGitAskpassScript(scriptPath: string): Promise<void> {
  await rm(scriptPath, { force: true });
}
