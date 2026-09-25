import { parseReleaseControllerConfig } from "./releaseControllerConfig";
import { createFirestoreReleaseIntentRepository } from "./releaseIntentRepository";
import { ensureReleaseIntentRecorded } from "./releaseIntentResolution";
import { exitCodeForReleaseControllerOutcome } from "./exitCode";
import { mintGithubDeliveryCredential } from "./githubAppCredential";
import { evaluateReleaseEligibility } from "./releaseEligibility";
import { executeEligibleReleaseStart } from "./releaseStartExecution";
import { runReleaseStartCompletionController } from "./releaseStartCompletionController";
import { observeCommit, observeFileContent, observeGitRefSha, observeRepositoryPackageVersion } from "./releaseRepositoryObservation";
import { materializeRepositoryWorkspace } from "./repositoryWorkspace";
import { runGit } from "./gitProcess";

import type { ReleaseControllerOutcome } from "./exitCode";
import type { MintGithubDeliveryCredential } from "./githubAppCredential";
import type { EvaluateReleaseEligibilityForIntent, ExecuteEligibleReleaseStartForIntent } from "./releaseStartExecution";
import type { ExecutorLogger } from "./runExecutor";

/**
 * Structured stdout/stderr logger — duplicated from `main.ts`/`ciControllerMain.ts`/
 * `mergeControllerMain.ts` rather than shared, for the same reason as those files: this is a
 * separate deployable entry point (its own Cloud Run Job, see
 * `executor/deploy/deploy.sh`'s `deploy-release-controller-job`), and none of them is changed by
 * this file's existence.
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

const observePackageVersion = (request: { repository: string; ref: string }) =>
  observeRepositoryPackageVersion({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential });

const observeCommitBound = (request: { repository: string; sha: string }) =>
  observeCommit({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential });

const observeFileContentBound = (request: { repository: string; ref: string; path: string }) =>
  observeFileContent({ ...request, fetchImpl: fetch, mintCredential: mintDeliveryCredential });

/**
 * The only place in this file that reads `process.env` for real or calls `process.exit`. Mirrors
 * `mergeControllerMain.ts`'s shape but is a fully separate entry point/Cloud Run Job command.
 *
 * Two composed stages, both built entirely from already-tested, unmodified primitives:
 *
 * 1. `ensureReleaseIntentRecorded` — closes the gap between "the Firebase launcher passes only
 *    `releaseIntentId`" and "`evaluateReleaseEligibility` requires the release intent to already be
 *    persisted": idempotently resolves a fresh `sourceRevision` and records the intent (via the
 *    existing, unmodified `recordReleaseIntent`) only when no matching intent exists yet, using
 *    this Job's own trusted `repository`/`sourceBranch` configuration — never a caller-supplied
 *    value.
 * 2. The existing `evaluateReleaseEligibility` -> `executeEligibleReleaseStart` ->
 *    `runReleaseStartCompletionController` chain, reused verbatim, bound over the now-guaranteed-
 *    present release intent.
 */
async function main(): Promise<void> {
  let releaseIntentId: string;
  let expectedRepository: string;
  let expectedSourceBranch: string;
  try {
    const config = parseReleaseControllerConfig(process.env);
    releaseIntentId = config.releaseIntentId;
    expectedRepository = config.repository;
    expectedSourceBranch = config.sourceBranch;
  } catch {
    jsonLogger.error("Invalid or missing release-controller environment configuration.");
    process.exit(1);
    return;
  }

  const repository = createFirestoreReleaseIntentRepository();

  const resolutionOutcome = await ensureReleaseIntentRecorded({
    releaseIntentId,
    expectedRepository,
    expectedSourceBranch,
    repository,
    observeGitRef,
    logger: jsonLogger,
  });

  if (resolutionOutcome.outcome !== "recorded") {
    process.exit(exitCodeForReleaseControllerOutcome(resolutionOutcome));
    return;
  }

  const evaluateEligibilityForIntent: EvaluateReleaseEligibilityForIntent = (intentId) =>
    evaluateReleaseEligibility({
      releaseIntentId: intentId,
      expectedRepository,
      expectedSourceBranch,
      repository,
      observeGitRef,
      observePackageVersion,
      observeCommit: observeCommitBound,
      observeFileContent: observeFileContentBound,
      logger: jsonLogger,
    });

  const executeReleaseStartForIntent: ExecuteEligibleReleaseStartForIntent = (intentId) =>
    executeEligibleReleaseStart({
      releaseIntentId: intentId,
      evaluateReleaseEligibility: evaluateEligibilityForIntent,
      materializeRepositoryWorkspace: (request) => materializeRepositoryWorkspace({ ...request, runGit }),
      runGit,
      env: process.env,
      mintCredential: mintDeliveryCredential,
      logger: jsonLogger,
    });

  const outcome: ReleaseControllerOutcome = await runReleaseStartCompletionController({
    releaseIntentId,
    executeEligibleReleaseStart: executeReleaseStartForIntent,
    repository,
    logger: jsonLogger,
  });

  process.exit(exitCodeForReleaseControllerOutcome(outcome));
}

main().catch((error: unknown) => {
  jsonLogger.error("Unhandled release-controller failure.", {
    error: error instanceof Error ? error.message : "unknown error",
  });
  process.exit(1);
});
