import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";

import { deleteApp, initializeApp } from "firebase-admin/app";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { afterAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const entryPoint = path.join(__dirname, "..", "lib", "main.js");

const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const describeWithEmulator = firestoreEmulatorHost ? describe : describe.skip;

/**
 * Spawns the actual compiled CLI entry point as a real child process (real `process.exit`,
 * no Vitest process termination risk), the closest available proxy to the "run the container
 * with deliberately missing configuration" container-validation check when a Docker daemon is
 * unavailable in this environment.
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

describe("main.ts CLI entry point (compiled lib/main.js)", () => {
  it("exits non-zero when ADA_EXECUTION_RUN_ID is missing", async () => {
    // Arrange
    const env = { ADA_EXECUTION_RUN_ID: undefined };

    // Act
    const result = await runCli(env);

    // Assert
    expect(result.exitCode).not.toBe(0);
  });

  it("exits non-zero when ADA_EXECUTION_RUN_ID is blank", async () => {
    // Arrange
    const env = { ADA_EXECUTION_RUN_ID: "   " };

    // Act
    const result = await runCli(env);

    // Assert
    expect(result.exitCode).not.toBe(0);
  });

  describeWithEmulator("with the Firestore emulator", () => {
    const projectId = process.env.GCLOUD_PROJECT ?? "demo-kanban-app-test";
    const app = initializeApp({ projectId }, `executor-cli-integration-${randomUUID()}`);
    const firestore = getFirestore(app);

    afterAll(async () => {
      await deleteApp(app);
    });

    it("exits 0 for a real accepted run loaded end-to-end through the compiled CLI", async () => {
      // Arrange
      const executionRequestId = `req-${randomUUID()}`;
      await firestore
        .collection("executionRuns")
        .doc(executionRequestId)
        .set({
          executionRequestId,
          correlationId: executionRequestId,
          projectId: "project-1",
          cardId: "card-1",
          status: "accepted",
          acceptedAt: Timestamp.now(),
          input: {
            schemaVersion: 1,
            eventType: "ada.execution.requested",
            title: "Ship the demo",
            prompt: "Ship the demo build.",
            repository: "johnpwise/kanban-app",
            baseBranch: "develop",
            requestedBy: "user-1",
            requestedAt: "2026-09-20T00:00:00.000Z",
          },
        });

      // Act
      const result = await runCli({
        ADA_EXECUTION_RUN_ID: executionRequestId,
        FIRESTORE_EMULATOR_HOST: firestoreEmulatorHost,
        GCLOUD_PROJECT: projectId,
      });

      // Assert
      expect(result.exitCode).toBe(0);
    });

    it("exits non-zero for a run id with no matching document", async () => {
      // Arrange
      const executionRequestId = `req-${randomUUID()}`;

      // Act
      const result = await runCli({
        ADA_EXECUTION_RUN_ID: executionRequestId,
        FIRESTORE_EMULATOR_HOST: firestoreEmulatorHost,
        GCLOUD_PROJECT: projectId,
      });

      // Assert
      expect(result.exitCode).not.toBe(0);
    });
  });
});
