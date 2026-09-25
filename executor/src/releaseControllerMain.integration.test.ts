import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const entryPoint = path.join(__dirname, "..", "lib", "releaseControllerMain.js");

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

const REPOSITORY = "johnpwise/kanban-app";
const SOURCE_BRANCH = "develop";

/**
 * Spawns the actual compiled release-controller entry point as a real child process, mirroring
 * `ciControllerMain.integration.test.ts`'s/`main.integration.test.ts`'s rationale exactly (real
 * `process.exit`, no Vitest process termination risk).
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

describe("releaseControllerMain.ts CLI entry point (compiled lib/releaseControllerMain.js)", () => {
  it("exits non-zero when ADA_RELEASE_INTENT_ID is missing", async () => {
    // Arrange
    const env = {
      ADA_RELEASE_INTENT_ID: undefined,
      ADA_RELEASE_REPOSITORY: REPOSITORY,
      ADA_RELEASE_SOURCE_BRANCH: SOURCE_BRANCH,
    };

    // Act
    const result = await runCli(env);

    // Assert
    expect(result.exitCode).not.toBe(0);
  });

  it("exits non-zero when ADA_RELEASE_REPOSITORY is missing", async () => {
    // Arrange
    const env = {
      ADA_RELEASE_INTENT_ID: "johnpwise__kanban-app--0.2.0",
      ADA_RELEASE_REPOSITORY: undefined,
      ADA_RELEASE_SOURCE_BRANCH: SOURCE_BRANCH,
    };

    // Act
    const result = await runCli(env);

    // Assert
    expect(result.exitCode).not.toBe(0);
  });

  it("exits non-zero when ADA_RELEASE_SOURCE_BRANCH is blank", async () => {
    // Arrange
    const env = {
      ADA_RELEASE_INTENT_ID: "johnpwise__kanban-app--0.2.0",
      ADA_RELEASE_REPOSITORY: REPOSITORY,
      ADA_RELEASE_SOURCE_BRANCH: "   ",
    };

    // Act
    const result = await runCli(env);

    // Assert
    expect(result.exitCode).not.toBe(0);
  });

  describeWithEmulator("with the Firestore emulator", () => {
    const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
    const app = initializeApp({ projectId }, `executor-release-controller-cli-integration-${randomUUID()}`);
    getFirestore(app);

    afterAll(async () => {
      await deleteApp(app);
    });

    // No live GitHub App credential is configured in this environment, so a release-intent-id
    // that decodes to a valid, undecided version still fails closed at the fresh source-branch
    // observation step — this is exactly the intended fail-closed behaviour (never guessing/
    // caching a sourceRevision), not a gap in this test's coverage. A genuine `exit 0` requires a
    // live GitHub App credential and a real repository, deferred to the same explicit operational
    // approval boundary as the other controllers' own skipped end-to-end cases.
    it("exits non-zero for a release intent id with no matching document and no live GitHub credential", async () => {
      // Arrange
      const version = "0.2.0";
      const releaseIntentId = `johnpwise__kanban-app--${version}`;

      // Act
      const result = await runCli({
        ADA_RELEASE_INTENT_ID: releaseIntentId,
        ADA_RELEASE_REPOSITORY: REPOSITORY,
        ADA_RELEASE_SOURCE_BRANCH: SOURCE_BRANCH,
        FIRESTORE_EMULATOR_HOST: firestoreEmulatorHost,
        GCLOUD_PROJECT: projectId,
      });

      // Assert
      expect(result.exitCode).not.toBe(0);
    });

    it("exits non-zero for a release intent id that cannot be decoded against the trusted repository", async () => {
      // Arrange
      const releaseIntentId = "not-a-valid-release-intent-id";

      // Act
      const result = await runCli({
        ADA_RELEASE_INTENT_ID: releaseIntentId,
        ADA_RELEASE_REPOSITORY: REPOSITORY,
        ADA_RELEASE_SOURCE_BRANCH: SOURCE_BRANCH,
        FIRESTORE_EMULATOR_HOST: firestoreEmulatorHost,
        GCLOUD_PROJECT: projectId,
      });

      // Assert
      expect(result.exitCode).not.toBe(0);
    });
  });
});
