import { createOrReuseAdaPullRequest } from "./adaPullRequest";
import { parseCodexProviderConfig } from "./codexProviderConfig";
import { ensureAdaDeliveryBranch } from "./deliveryBranch";
import { ensureAdaDeliveryCommit } from "./deliveryCommit";
import { ensureAdaDeliveryPush } from "./deliveryPush";
import { createFirestoreExecutionRunRepository } from "./executionRunRepository";
import { exitCodeForOutcome } from "./exitCode";
import { mintGithubDeliveryCredential } from "./githubAppCredential";
import type { MintGithubDeliveryCredential } from "./githubAppCredential";
import { verifyGitIntegrity } from "./gitIntegrityVerification";
import { runGit } from "./gitProcess";
import { createProcessInvokeCodingAgent } from "./processCodingAgentRuntime";
import { materializeRepositoryWorkspace } from "./repositoryWorkspace";
import { runExecutor } from "./runExecutor";
import { inspectWorkingTree } from "./workingTreeInspection";

import type { InvokeCodingAgent } from "./codingAgentInvocation";
import type { ExecutorLogger } from "./runExecutor";

/**
 * Structured stdout/stderr logger. Cloud Run/Cloud Logging parse JSON log lines automatically;
 * fields passed here must already be limited to safe identifiers by the caller (`runExecutor`).
 */
const jsonLogger: ExecutorLogger = {
  info(message, fields) {
    console.log(JSON.stringify({ severity: "INFO", message, ...fields }));
  },
  error(message, fields) {
    console.error(JSON.stringify({ severity: "ERROR", message, ...fields }));
  },
};

/**
 * Resolves the Codex provider config from `process.env` at invocation time, not at module load —
 * so a missing/invalid `CODEX_API_KEY` surfaces as the existing, already-safe
 * `coding_agent_invocation_error` outcome (via `runExecutor`'s surrounding try/catch) rather than
 * an unhandled startup crash.
 */
const invokeCodingAgent: InvokeCodingAgent = async (invocation) => {
  await createProcessInvokeCodingAgent(parseCodexProviderConfig(process.env))(invocation);
};

/**
 * Resolves the GitHub App installation credential from `process.env` at invocation time, like
 * `invokeCodingAgent` above — reads only the `ADA_GITHUB_APP_*` env vars, a distinct namespace
 * from `CODEX_*`, so this credential can never collide with or be pulled into the coding-agent
 * child-process env built by `parseCodexProviderConfig`.
 */
const mintDeliveryCredential: MintGithubDeliveryCredential = ({ repository }) =>
  mintGithubDeliveryCredential({ repository, env: process.env, now: Date.now, fetchImpl: fetch });

/**
 * The only place in this package that reads `process.env` for real or calls `process.exit`.
 * Kept intentionally thin: all branching logic lives in the fully unit-tested `runExecutor`.
 */
async function main(): Promise<void> {
  const outcome = await runExecutor({
    env: process.env,
    repository: createFirestoreExecutionRunRepository(),
    logger: jsonLogger,
    materializeRepositoryWorkspace: (request) => materializeRepositoryWorkspace({ ...request, runGit }),
    invokeCodingAgent,
    verifyGitIntegrity: (request) => verifyGitIntegrity({ ...request, runGit }),
    inspectWorkingTree: (request) => inspectWorkingTree({ ...request, runGit }),
    ensureAdaDeliveryBranch: (request) => ensureAdaDeliveryBranch({ ...request, runGit }),
    ensureAdaDeliveryCommit: (request) => ensureAdaDeliveryCommit({ ...request, runGit }),
    ensureAdaDeliveryPush: (request) =>
      ensureAdaDeliveryPush({ ...request, env: process.env, runGit, mintCredential: mintDeliveryCredential }),
    createOrReuseAdaPullRequest: (request) =>
      createOrReuseAdaPullRequest({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential }),
  });
  process.exit(exitCodeForOutcome(outcome));
}

main().catch((error: unknown) => {
  jsonLogger.error("Unhandled executor failure.", {
    error: error instanceof Error ? error.message : "unknown error",
  });
  process.exit(1);
});
