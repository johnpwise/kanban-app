import { parseReleaseCiControllerConfig } from "./releaseCiControllerConfig";
import { createFirestoreReleaseIntentRepository } from "./releaseIntentRepository";
import { exitCodeForReleaseCiControllerOutcome } from "./exitCode";
import { mintGithubDeliveryCredential } from "./githubAppCredential";
import { observeReleaseCiStatus } from "./releaseCiObservation";
import { observeReleaseCiForReleasePullRequest } from "./releasePullRequestCiObservation";
import { runReleaseCiController } from "./releaseCiController";
import { observeGithubPullRequest } from "./githubPullRequestObservation";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";
import type { ObserveReleaseCiForReleasePullRequestForIntent } from "./releaseCiController";
import type { ObserveReleaseCiStatus } from "./releaseCiObservation";
import type { ObserveGithubPullRequest } from "./githubPullRequestObservation";
import type { ExecutorLogger } from "./runExecutor";

/**
 * Structured stdout/stderr logger — duplicated from every other controller entry point rather than
 * shared, for the same reason as those files: this is a separate deployable entry point (its own
 * Cloud Run Job), and none of them is changed by this file's existence.
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
 * only the `ADA_GITHUB_APP_*` namespace — same as every other controller's own mint. No `CODEX_*`
 * variable is ever read here: this runtime never invokes Codex.
 */
const mintDeliveryCredential: MintGithubDeliveryCredential = ({ repository }) =>
  mintGithubDeliveryCredential({ repository, env: process.env, now: Date.now, fetchImpl: fetch });

const observePullRequest: ObserveGithubPullRequest = (request) =>
  observeGithubPullRequest({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential });

const observeCiStatus: ObserveReleaseCiStatus = (request) =>
  observeReleaseCiStatus({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential });

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Sized to match `ciControllerMain.ts`'s own `CI_CONTROLLER_POLICY` total window (~27.5 minutes),
 * but here that window covers *both* targets per round rather than one target polled serially —
 * `main` and `develop` are always observed within the same round, never one after the other across
 * separate windows.
 */
const RELEASE_CI_CONTROLLER_POLICY = { maxRounds: 55, delayMs: 30_000 };

/**
 * The only place in this file that reads `process.env` for real or calls `process.exit`. A
 * dedicated entry point/Cloud Run Job command, per the one-file-per-controller-stage convention —
 * never a stage bolted onto `releasePullRequestControllerMain.ts`. Composes the existing, unmodified
 * `observeReleaseCiForReleasePullRequest` (PR #66) over this Job's own `observeGithubPullRequest`/
 * `observeReleaseCiStatus`, plus the new `runReleaseCiController` over that and
 * `repository.recordReleaseCiResult` — no other input can steer which release, repository, or
 * targets this run acts on.
 */
async function main(): Promise<void> {
  let releaseIntentId: string;
  try {
    releaseIntentId = parseReleaseCiControllerConfig(process.env).releaseIntentId;
  } catch {
    jsonLogger.error("Invalid or missing release-CI-controller environment configuration.");
    process.exit(1);
    return;
  }

  const repository = createFirestoreReleaseIntentRepository();

  const observeForIntent: ObserveReleaseCiForReleasePullRequestForIntent = (intentId, target) =>
    observeReleaseCiForReleasePullRequest({
      releaseIntentId: intentId,
      target,
      repository,
      observeGithubPullRequest: observePullRequest,
      observeReleaseCiStatus: observeCiStatus,
      logger: jsonLogger,
    });

  const outcome = await runReleaseCiController({
    releaseIntentId,
    observeReleaseCiForReleasePullRequest: observeForIntent,
    repository,
    wait,
    policy: RELEASE_CI_CONTROLLER_POLICY,
    logger: jsonLogger,
  });

  process.exit(exitCodeForReleaseCiControllerOutcome(outcome));
}

main().catch((error: unknown) => {
  jsonLogger.error("Unhandled release-CI-controller failure.", {
    error: error instanceof Error ? error.message : "unknown error",
  });
  process.exit(1);
});
