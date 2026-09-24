import { parseExecutorConfig } from "./config";
import { runDeliveryCiController } from "./deliveryCiController";
import { observeDeliveryCiStatus } from "./deliveryCiObservation";
import { createFirestoreExecutionRunRepository } from "./executionRunRepository";
import { exitCodeForCiControllerOutcome } from "./exitCode";
import { mintGithubDeliveryCredential } from "./githubAppCredential";

import type { DeliveryCiControllerPolicy } from "./deliveryCiController";
import type { ObserveDeliveryCiStatus } from "./deliveryCiObservation";
import type { MintGithubDeliveryCredential } from "./githubAppCredential";
import type { ExecutorLogger } from "./runExecutor";

/**
 * Structured stdout/stderr logger — duplicated from `main.ts` rather than shared: this is a
 * separate deployable entry point (its own Cloud Run Job, see `executor/deploy/deploy.sh`), and
 * `main.ts` is left entirely unchanged by this file's existence (the coding executor continues to
 * exit independently of CI, per `deliveryCiController.ts`'s own docstring).
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
 * only the `ADA_GITHUB_APP_*` namespace — same as `main.ts`'s `mintDeliveryCredential`. No
 * `CODEX_*` variable is ever read here: this runtime never invokes Codex.
 */
const mintDeliveryCredential: MintGithubDeliveryCredential = ({ repository }) =>
  mintGithubDeliveryCredential({ repository, env: process.env, now: Date.now, fetchImpl: fetch });

const observe: ObserveDeliveryCiStatus = (request) =>
  observeDeliveryCiStatus({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential });

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Sized to fit safely inside the `ada-ci-controller` Cloud Run Job's 1800s (30 minute)
 * `--task-timeout` (see `executor/deploy/deploy.sh`'s ci-controller deploy step): 55 observations
 * at a 30-second delay is a worst-case ~1620s (27 minutes) of idle waiting between attempts, plus
 * per-attempt GitHub API round-trip time (one credential mint + one workflow-runs GET, each well
 * under a second in practice) — leaving a multi-minute buffer under the task timeout even in the
 * worst case. `.github/workflows/ci.yml` runs three parallel jobs (app/functions/executor), each
 * doing install/lint/typecheck/build/test; in practice they complete in well under 10 minutes, so
 * this window comfortably covers normal GitHub Actions queueing/runtime variance without
 * approaching the bound.
 */
const CI_CONTROLLER_POLICY: DeliveryCiControllerPolicy = { maxObservations: 55, delayMs: 30_000 };

/**
 * The only place in this file that reads `process.env` for real or calls `process.exit`. Mirrors
 * `main.ts`'s shape but is a fully separate entry point/Cloud Run Job command — all branching logic
 * lives in the already fully unit-tested `runDeliveryCiController` (PR #48) and
 * `observeDeliveryCiStatus`, reused unmodified here.
 */
async function main(): Promise<void> {
  let executionRunId: string;
  try {
    executionRunId = parseExecutorConfig(process.env).executionRunId;
  } catch {
    jsonLogger.error("Invalid or missing CI-controller environment configuration.");
    process.exit(1);
    return;
  }

  const outcome = await runDeliveryCiController({
    executionRunId,
    repository: createFirestoreExecutionRunRepository(),
    observe,
    wait,
    policy: CI_CONTROLLER_POLICY,
    logger: jsonLogger,
  });

  process.exit(exitCodeForCiControllerOutcome(outcome));
}

main().catch((error: unknown) => {
  jsonLogger.error("Unhandled CI-controller failure.", {
    error: error instanceof Error ? error.message : "unknown error",
  });
  process.exit(1);
});
