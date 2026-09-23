import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createProcessInvokeCodingAgent, spawnCodingAgentProcess } from "./processCodingAgentRuntime";

const FIXTURES_DIR = join(__dirname, "testHelpers", "fixtures");
const RECORD_INVOCATION = join(FIXTURES_DIR, "recordProcessInvocation.mjs");
const EXIT_WITH_CODE = join(FIXTURES_DIR, "exitWithCode.mjs");
const HANG_FOREVER = join(FIXTURES_DIR, "hangForever.mjs");

/**
 * These tests spawn real local Node fixture scripts (no shell, no network, no AI provider) to prove
 * the process-execution boundary end to end — real `cwd`, real stdin delivery, real exit codes, and
 * real timeout/kill behaviour — mirroring `repositoryWorkspace.integration.test.ts`'s convention
 * that real subprocess execution belongs at this test tier.
 */
describe("processCodingAgentRuntime (real process boundary)", () => {
  let workspacePath: string;

  afterEach(async () => {
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true });
    }
  });

  it("runs the process with the materialised workspace path as cwd, and delivers the task as plain text via stdin", async () => {
    // Arrange
    workspacePath = await mkdtemp(join(tmpdir(), "ada-coding-agent-workspace-"));
    const outputDir = await mkdtemp(join(tmpdir(), "ada-coding-agent-output-"));
    const outputPath = join(outputDir, "recorded.json");
    const invocation = {
      executionRequestId: "execution-request-id",
      task: { title: "task-title", prompt: "task-prompt" },
      workspace: { path: workspacePath, headSha: "a".repeat(40) },
    };
    const invoke = createProcessInvokeCodingAgent({
      command: process.execPath,
      args: [RECORD_INVOCATION, outputPath],
      timeoutMs: 5_000,
    });

    // Act
    await invoke(invocation);

    // Assert
    const recorded = JSON.parse(await readFile(outputPath, "utf8"));
    expect(recorded.cwd).toBe(await realpath(workspacePath));
    expect(recorded.stdinPayload).toBe("task-title\n\ntask-prompt");
    await rm(outputDir, { recursive: true, force: true });
  });

  it("rejects with a safe non_zero_exit error when the process exits non-zero", async () => {
    // Arrange
    workspacePath = await mkdtemp(join(tmpdir(), "ada-coding-agent-workspace-"));
    const invocation = {
      executionRequestId: "execution-request-id",
      task: { title: "task-title", prompt: "task-prompt" },
      workspace: { path: workspacePath, headSha: "a".repeat(40) },
    };
    const invoke = createProcessInvokeCodingAgent({
      command: process.execPath,
      args: [EXIT_WITH_CODE, "7"],
      timeoutMs: 5_000,
    });

    // Act & Assert
    await expect(invoke(invocation)).rejects.toMatchObject({ name: "ProcessCodingAgentRuntimeError", kind: "non_zero_exit" });
  });

  it("rejects with a safe spawn_failed error when the executable does not exist", async () => {
    // Arrange
    workspacePath = await mkdtemp(join(tmpdir(), "ada-coding-agent-workspace-"));
    const invocation = {
      executionRequestId: "execution-request-id",
      task: { title: "task-title", prompt: "task-prompt" },
      workspace: { path: workspacePath, headSha: "a".repeat(40) },
    };
    const invoke = createProcessInvokeCodingAgent({
      command: join(FIXTURES_DIR, "does-not-exist-binary"),
      timeoutMs: 5_000,
    });

    // Act & Assert
    await expect(invoke(invocation)).rejects.toMatchObject({ name: "ProcessCodingAgentRuntimeError", kind: "spawn_failed" });
  });

  it("terminates and rejects with a safe timeout error when the process hangs past the bounded timeout", async () => {
    // Arrange
    workspacePath = await mkdtemp(join(tmpdir(), "ada-coding-agent-workspace-"));
    const invocation = {
      executionRequestId: "execution-request-id",
      task: { title: "task-title", prompt: "task-prompt" },
      workspace: { path: workspacePath, headSha: "a".repeat(40) },
    };
    const invoke = createProcessInvokeCodingAgent({
      command: process.execPath,
      args: [HANG_FOREVER],
      timeoutMs: 300,
    });

    // Act & Assert
    await expect(invoke(invocation)).rejects.toMatchObject({ name: "ProcessCodingAgentRuntimeError", kind: "timeout" });
  });

  it("the underlying spawnCodingAgentProcess primitive never throws, resolving ok:false instead, for a real startup failure", async () => {
    // Arrange & Act
    const outcome = await spawnCodingAgentProcess({
      command: join(FIXTURES_DIR, "does-not-exist-binary"),
      args: [],
      cwd: tmpdir(),
      timeoutMs: 5_000,
      env: process.env,
      stdinPayload: "{}",
    });

    // Assert
    expect(outcome).toEqual({ ok: false, kind: "spawn_failed", code: "ENOENT" });
  });
});
