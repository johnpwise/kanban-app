import { parseExecutorConfig } from "./config";
import { observeDeliveryPullRequest } from "./deliveryPullRequestObservation";
import { createFirestoreExecutionRunRepository } from "./executionRunRepository";
import { exitCodeForMergeControllerOutcome } from "./exitCode";
import { mintGithubDeliveryCredential } from "./githubAppCredential";
import { mergeAdaPullRequest } from "./adaPullRequestMerge";
import { evaluateMergeEligibility } from "./mergeEligibility";
import { executeEligibleDeliveryMerge } from "./mergeExecution";
import { runMergeCompletionController } from "./mergeCompletionController";
import { runMergeCompletionControllerWithRetry } from "./mergeCompletionRetryController";

import type { ObserveDeliveryPullRequest } from "./deliveryPullRequestObservation";
import type { MintGithubDeliveryCredential } from "./githubAppCredential";
import type { MergeAdaPullRequest } from "./adaPullRequestMerge";
import type { EvaluateMergeEligibilityForRun } from "./mergeExecution";
import type { ExecuteEligibleDeliveryMergeForRun } from "./mergeCompletionController";
import type { RunMergeCompletionControllerForRun, MergeCompletionRetryPolicy } from "./mergeCompletionRetryController";
import type { ExecutorLogger } from "./runExecutor";

/**
 * Structured stdout/stderr logger — duplicated from `main.ts`/`ciControllerMain.ts` rather than
 * shared: this is a separate deployable entry point (its own Cloud Run Job, see
 * `executor/deploy/deploy.sh`), and neither of those files is changed by this file's existence —
 * the coding executor and the CI controller each continue to exit independently of merge
 * completion.
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
 * Resolves the GitHub App installation credential from `process.env` at invocation time, reading
 * only the `ADA_GITHUB_APP_*` namespace — same as `main.ts`'s/`ciControllerMain.ts`'s own mint.
 * No `CODEX_*` variable is ever read here: this runtime never invokes Codex.
 */
const mintDeliveryCredential: MintGithubDeliveryCredential = ({ repository }) =>
  mintGithubDeliveryCredential({ repository, env: process.env, now: Date.now, fetchImpl: fetch });

const observePullRequest: ObserveDeliveryPullRequest = (request) =>
  observeDeliveryPullRequest({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential });

const mergePullRequest: MergeAdaPullRequest = (request) =>
  mergeAdaPullRequest({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential });

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Sized independently from `ciControllerMain.ts`'s `CI_CONTROLLER_POLICY`: GitHub's own
 * `mergeable` computation is an internal, typically sub-second-to-few-seconds operation, not an
 * external CI pipeline that can run for minutes — a large observation window like the
 * CI-controller's would be the wrong bound here. 10 attempts at a 3-second delay is a worst-case
 * ~27s of idle waiting between attempts, comfortably inside the `ada-merge-controller` Cloud Run
 * Job's `--task-timeout` (see `executor/deploy/deploy.sh`'s merge-controller deploy step), with
 * ample margin for per-attempt GitHub API round-trip time (one credential mint + one PR GET, each
 * well under a second in practice).
 */
const MERGE_COMPLETION_RETRY_POLICY: MergeCompletionRetryPolicy = { maxAttempts: 10, delayMs: 3_000 };

/**
 * The only place in this file that reads `process.env` for real or calls `process.exit`. Mirrors
 * `ciControllerMain.ts`'s shape but is a fully separate entry point/Cloud Run Job command — all
 * branching logic lives in the already fully unit-tested `evaluateMergeEligibility` (PR #52),
 * `executeEligibleDeliveryMerge` (PR #53), `runMergeCompletionController` (PR #54), and
 * `runMergeCompletionControllerWithRetry` (this slice), reused unmodified here. Composition only:
 * `evaluateMergeEligibility` is bound over `repository`/`observePullRequest`;
 * `executeEligibleDeliveryMerge` is bound over that plus `mergePullRequest`;
 * `runMergeCompletionController` is bound over that plus `repository`; each re-runs fresh on
 * every retry attempt, never a cached prior result.
 */
async function main(): Promise<void> {
  let executionRunId: string;
  try {
    executionRunId = parseExecutorConfig(process.env).executionRunId;
  } catch {
    jsonLogger.error("Invalid or missing merge-controller environment configuration.");
    process.exit(1);
    return;
  }

  const repository = createFirestoreExecutionRunRepository();

  const evaluateEligibilityForRun: EvaluateMergeEligibilityForRun = (runId) =>
    evaluateMergeEligibility({ executionRunId: runId, repository, observePullRequest, logger: jsonLogger });

  const executeMergeForRun: ExecuteEligibleDeliveryMergeForRun = (runId) =>
    executeEligibleDeliveryMerge({
      executionRunId: runId,
      evaluateMergeEligibility: evaluateEligibilityForRun,
      mergeAdaPullRequest: mergePullRequest,
      logger: jsonLogger,
    });

  const runControllerForRun: RunMergeCompletionControllerForRun = (runId) =>
    runMergeCompletionController({
      executionRunId: runId,
      executeEligibleDeliveryMerge: executeMergeForRun,
      repository,
      logger: jsonLogger,
    });

  const outcome = await runMergeCompletionControllerWithRetry({
    executionRunId,
    runMergeCompletionController: runControllerForRun,
    wait,
    policy: MERGE_COMPLETION_RETRY_POLICY,
    logger: jsonLogger,
  });

  process.exit(exitCodeForMergeControllerOutcome(outcome));
}

main().catch((error: unknown) => {
  jsonLogger.error("Unhandled merge-controller failure.", {
    error: error instanceof Error ? error.message : "unknown error",
  });
  process.exit(1);
});
