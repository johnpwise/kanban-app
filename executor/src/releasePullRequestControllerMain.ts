import { parseReleasePullRequestControllerConfig } from "./releasePullRequestControllerConfig";
import { createFirestoreReleaseIntentRepository } from "./releaseIntentRepository";
import { exitCodeForReleasePullRequestControllerOutcome } from "./exitCode";
import { mintGithubDeliveryCredential } from "./githubAppCredential";
import { evaluateReleasePullRequestEligibility } from "./releasePullRequestEligibility";
import { executeEligibleReleasePullRequest } from "./releasePullRequestExecution";
import { runReleasePullRequestCompletionController } from "./releasePullRequestCompletionController";
import { observeGitRefSha } from "./releaseRepositoryObservation";
import { createOrReuseGithubPullRequest } from "./githubPullRequest";
import { observeGithubPullRequest } from "./githubPullRequestObservation";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";
import type { ExecuteEligibleReleasePullRequestForIntent } from "./releasePullRequestCompletionController";
import type { EvaluateReleasePullRequestEligibilityForIntent } from "./releasePullRequestExecution";
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

const observeGitRef = (request: { repository: string; ref: string }) =>
  observeGitRefSha({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential });

const createOrReusePullRequest = (request: { repository: string; head: string; base: string; title: string; body: string }) =>
  createOrReuseGithubPullRequest({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential });

const observePullRequest = (request: { repository: string; pullRequestNumber: number }) =>
  observeGithubPullRequest({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential });

/**
 * The only place in this file that reads `process.env` for real or calls `process.exit`. A
 * dedicated entry point/Cloud Run Job command, per the one-file-per-controller-stage convention —
 * never a stage bolted onto `releaseControllerMain.ts`. Unlike that controller, this stage never
 * calls `ensureReleaseIntentRecorded`: the release intent (and its durable `start` result) must
 * already exist by the time this stage runs — `evaluateReleasePullRequestEligibility` already fails
 * closed if it does not, so no intent-bootstrap step belongs here.
 *
 * The full chain — `evaluateReleasePullRequestEligibility` -> `executeEligibleReleasePullRequest`
 * (bound once per target) -> `runReleasePullRequestCompletionController` — is reused verbatim from
 * increments 4-6, composed only from this Job's own trusted `releaseIntentId`/`repository`
 * deploy-time configuration; no other input can steer which release, repository, branch, or PR this
 * run acts on.
 */
async function main(): Promise<void> {
  let releaseIntentId: string;
  let expectedRepository: string;
  try {
    const config = parseReleasePullRequestControllerConfig(process.env);
    releaseIntentId = config.releaseIntentId;
    expectedRepository = config.repository;
  } catch {
    jsonLogger.error("Invalid or missing release-pull-request-controller environment configuration.");
    process.exit(1);
    return;
  }

  const repository = createFirestoreReleaseIntentRepository();

  const evaluateEligibilityForIntent: EvaluateReleasePullRequestEligibilityForIntent = (intentId) =>
    evaluateReleasePullRequestEligibility({
      releaseIntentId: intentId,
      expectedRepository,
      repository,
      observeGitRef,
      logger: jsonLogger,
    });

  const executeForIntent: ExecuteEligibleReleasePullRequestForIntent = (intentId, target) =>
    executeEligibleReleasePullRequest({
      releaseIntentId: intentId,
      target,
      evaluateReleasePullRequestEligibility: evaluateEligibilityForIntent,
      createOrReuseGithubPullRequest: createOrReusePullRequest,
      observeGithubPullRequest: observePullRequest,
      logger: jsonLogger,
    });

  const outcome = await runReleasePullRequestCompletionController({
    releaseIntentId,
    executeEligibleReleasePullRequest: executeForIntent,
    repository,
    logger: jsonLogger,
  });

  process.exit(exitCodeForReleasePullRequestControllerOutcome(outcome));
}

main().catch((error: unknown) => {
  jsonLogger.error("Unhandled release-pull-request-controller failure.", {
    error: error instanceof Error ? error.message : "unknown error",
  });
  process.exit(1);
});
