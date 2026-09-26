import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const entryPoint = path.join(__dirname, "..", "lib", "releasePullRequestControllerMain.js");

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

const REPOSITORY = "johnpwise/kanban-app";

/**
 * Spawns the actual compiled release-pull-request-controller entry point as a real child process,
 * mirroring `releaseControllerMain.integration.test.ts`'s rationale exactly (real `process.exit`,
 * no Vitest process termination risk).
 */
async function runCli(env: Record<string, string | undefined>): Promise<{ exitCode: number; stdout: string }> {
  try {
    const { stdout } = await execFileAsync("node", [entryPoint], { env: { ...process.env, ...env } });
    return { exitCode: 0, stdout };
  } catch (error) {
    const execError = error as { code?: number; stdout?: string };
    return { exitCode: execError.code ?? 1, stdout: execError.stdout ?? "" };
  }
}

describe("releasePullRequestControllerMain.ts CLI entry point (compiled lib/releasePullRequestControllerMain.js)", () => {
  it("exits non-zero when ADA_RELEASE_INTENT_ID is missing", async () => {
    // Arrange
    const env = { ADA_RELEASE_INTENT_ID: undefined, ADA_RELEASE_REPOSITORY: REPOSITORY };

    // Act
    const result = await runCli(env);

    // Assert
    expect(result.exitCode).not.toBe(0);
  });

  it("exits non-zero when ADA_RELEASE_REPOSITORY is missing", async () => {
    // Arrange
    const env = { ADA_RELEASE_INTENT_ID: "johnpwise__kanban-app--0.2.0", ADA_RELEASE_REPOSITORY: undefined };

    // Act
    const result = await runCli(env);

    // Assert
    expect(result.exitCode).not.toBe(0);
  });

  it("exits non-zero when ADA_RELEASE_REPOSITORY is not owner/repo", async () => {
    // Arrange
    const env = { ADA_RELEASE_INTENT_ID: "johnpwise__kanban-app--0.2.0", ADA_RELEASE_REPOSITORY: "not-a-repository" };

    // Act
    const result = await runCli(env);

    // Assert
    expect(result.exitCode).not.toBe(0);
  });

  describeWithEmulator("with the Firestore emulator", () => {
    const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
    const app = initializeApp({ projectId }, `executor-release-pull-request-controller-cli-integration-${randomUUID()}`);
    getFirestore(app);

    afterAll(async () => {
      await deleteApp(app);
    });

    // No live GitHub App credential is configured in this environment, and no matching release
    // intent document exists either — this fails closed at the fresh eligibility check's very
    // first step (release intent load), exactly the intended fail-closed behaviour. A genuine
    // `exit 0` requires a live GitHub App credential, a real repository, and a durable release
    // intent with a recorded `start` result — deferred to the same explicit operational approval
    // boundary as the other controllers' own skipped end-to-end cases. This never touches the real
    // `release/0.1.1` intent or branch: the id below is a distinct, unrelated placeholder version.
    it("exits non-zero for a release intent id with no matching document and no live GitHub credential", async () => {
      // Arrange
      const releaseIntentId = `johnpwise__kanban-app--9.9.9-${randomUUID()}`;

      // Act
      const result = await runCli({
        ADA_RELEASE_INTENT_ID: releaseIntentId,
        ADA_RELEASE_REPOSITORY: REPOSITORY,
        FIRESTORE_EMULATOR_HOST: firestoreEmulatorHost,
        GCLOUD_PROJECT: projectId,
      });

      // Assert
      expect(result.exitCode).not.toBe(0);
    });
  });
});
