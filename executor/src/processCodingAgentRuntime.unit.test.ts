import { EventEmitter } from "node:events";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createFakeSpawnCodingAgentProcess } from "./testHelpers/fakeSpawnCodingAgentProcess";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const { createProcessInvokeCodingAgent, ProcessCodingAgentRuntimeError, spawnCodingAgentProcess } = await import(
  "./processCodingAgentRuntime"
);

function fakeChildProcess(): { stdinEnd: ReturnType<typeof vi.fn>; emitter: EventEmitter } {
  const stdinEnd = vi.fn();
  const emitter = new EventEmitter();
  Object.assign(emitter, { stdin: { end: stdinEnd } });
  return { stdinEnd, emitter };
}

describe("spawnCodingAgentProcess", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  const baseParams = {
    command: "some-coding-agent",
    args: ["--flag"],
    cwd: "/workspace/path",
    timeoutMs: 5_000,
    env: { SAFE: "1" },
    stdinPayload: JSON.stringify({ title: "t", prompt: "p" }),
  };

  it("invokes the configured executable via execFile with an explicit argv array and no shell option", async () => {
    // Arrange
    const { emitter } = fakeChildProcess();
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null);
      return emitter;
    });

    // Act
    await spawnCodingAgentProcess(baseParams);

    // Assert
    const [file, args, options] = execFileMock.mock.calls[0];
    expect(file).toBe("some-coding-agent");
    expect(args).toEqual(["--flag"]);
    expect(options).not.toHaveProperty("shell");
  });

  it("passes cwd, env, and timeout through to execFile", async () => {
    // Arrange
    const { emitter } = fakeChildProcess();
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null);
      return emitter;
    });

    // Act
    await spawnCodingAgentProcess(baseParams);

    // Assert
    const [, , options] = execFileMock.mock.calls[0];
    expect(options.cwd).toBe("/workspace/path");
    expect(options.env).toEqual({ SAFE: "1" });
    expect(options.timeout).toBe(5_000);
  });

  it("writes the task payload to the child's stdin and closes it, never passing it via argv", async () => {
    // Arrange
    const { emitter, stdinEnd } = fakeChildProcess();
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null);
      return emitter;
    });

    // Act
    await spawnCodingAgentProcess(baseParams);

    // Assert
    expect(stdinEnd).toHaveBeenCalledWith(baseParams.stdinPayload);
    const [, args] = execFileMock.mock.calls[0];
    expect(JSON.stringify(args)).not.toContain("prompt");
  });

  it("resolves ok:true on successful completion", async () => {
    // Arrange
    const { emitter } = fakeChildProcess();
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(null);
      return emitter;
    });

    // Act
    const outcome = await spawnCodingAgentProcess(baseParams);

    // Assert
    expect(outcome).toEqual({ ok: true });
  });

  it("resolves ok:false kind:non_zero_exit with the numeric exit code, without throwing", async () => {
    // Arrange
    const { emitter } = fakeChildProcess();
    const error = Object.assign(new Error("exited"), { code: 3, killed: false });
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(error);
      return emitter;
    });

    // Act
    const outcome = await spawnCodingAgentProcess(baseParams);

    // Assert
    expect(outcome).toEqual({ ok: false, kind: "non_zero_exit", exitCode: 3 });
  });

  it("resolves ok:false kind:timeout when execFile reports the process was killed", async () => {
    // Arrange
    const { emitter } = fakeChildProcess();
    const error = Object.assign(new Error("timed out"), { killed: true, signal: "SIGTERM", code: null });
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(error);
      return emitter;
    });

    // Act
    const outcome = await spawnCodingAgentProcess(baseParams);

    // Assert
    expect(outcome).toEqual({ ok: false, kind: "timeout", signal: "SIGTERM" });
  });

  it("resolves ok:false kind:spawn_failed when the executable cannot be started", async () => {
    // Arrange
    const { emitter } = fakeChildProcess();
    const error = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT", killed: false });
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(error);
      return emitter;
    });

    // Act
    const outcome = await spawnCodingAgentProcess(baseParams);

    // Assert
    expect(outcome).toEqual({ ok: false, kind: "spawn_failed", code: "ENOENT" });
  });

  it("never includes the underlying error's message, or the stdin task payload, in the resolved outcome", async () => {
    // Arrange
    const { emitter } = fakeChildProcess();
    const error = Object.assign(new Error("unsafe-error-detail"), { code: 1, killed: false });
    execFileMock.mockImplementation((_file, _args, _options, callback) => {
      callback(error);
      return emitter;
    });
    const paramsWithDistinctivePayload = {
      ...baseParams,
      stdinPayload: JSON.stringify({ title: "distinctive-title", prompt: "distinctive-prompt" }),
    };

    // Act
    const outcome = await spawnCodingAgentProcess(paramsWithDistinctivePayload);

    // Assert
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("unsafe-error-detail");
    expect(serialized).not.toContain("distinctive-title");
    expect(serialized).not.toContain("distinctive-prompt");
  });
});

describe("createProcessInvokeCodingAgent", () => {
  const invocation = {
    executionRequestId: "execution-request-id",
    task: { title: "unsafe-title", prompt: "unsafe-prompt" },
    workspace: { path: "/workspace/path", headSha: "a".repeat(40) },
  };
  const config = { command: "some-coding-agent", timeoutMs: 5_000 };

  it("resolves without error when the spawn primitive reports success", async () => {
    // Arrange
    const { spawn } = createFakeSpawnCodingAgentProcess({ outcome: { ok: true } });
    const invoke = createProcessInvokeCodingAgent(config, spawn);

    // Act & Assert
    await expect(invoke(invocation)).resolves.toBeUndefined();
  });

  it("passes the workspace path as cwd and the task as a plain-text stdin payload to the spawn primitive", async () => {
    // Arrange: a real CLI coding-agent provider (unlike the prior placeholder) reads the whole of
    // stdin as literal prompt text, not a JSON envelope — see
    // .agent-workflows/codex-cli-executor-provider/checkpoints/artifact-004-research-spike.checkpoint.md
    const { spawn, calls } = createFakeSpawnCodingAgentProcess({ outcome: { ok: true } });
    const invoke = createProcessInvokeCodingAgent(config, spawn);

    // Act
    await invoke(invocation);

    // Assert
    expect(calls[0].cwd).toBe("/workspace/path");
    expect(calls[0].stdinPayload).toBe("unsafe-title\n\nunsafe-prompt");
  });

  it("throws a safe ProcessCodingAgentRuntimeError on non_zero_exit, containing only the exit code", async () => {
    // Arrange
    const { spawn } = createFakeSpawnCodingAgentProcess({ outcome: { ok: false, kind: "non_zero_exit", exitCode: 7 } });
    const invoke = createProcessInvokeCodingAgent(config, spawn);

    // Act & Assert
    await expect(invoke(invocation)).rejects.toMatchObject({
      name: "ProcessCodingAgentRuntimeError",
      kind: "non_zero_exit",
    });
  });

  it("throws a safe ProcessCodingAgentRuntimeError on spawn_failed", async () => {
    // Arrange
    const { spawn } = createFakeSpawnCodingAgentProcess({ outcome: { ok: false, kind: "spawn_failed", code: "ENOENT" } });
    const invoke = createProcessInvokeCodingAgent(config, spawn);

    // Act & Assert
    await expect(invoke(invocation)).rejects.toMatchObject({
      name: "ProcessCodingAgentRuntimeError",
      kind: "spawn_failed",
    });
  });

  it("throws a safe ProcessCodingAgentRuntimeError on timeout", async () => {
    // Arrange
    const { spawn } = createFakeSpawnCodingAgentProcess({ outcome: { ok: false, kind: "timeout", signal: "SIGTERM" } });
    const invoke = createProcessInvokeCodingAgent(config, spawn);

    // Act & Assert
    await expect(invoke(invocation)).rejects.toMatchObject({
      name: "ProcessCodingAgentRuntimeError",
      kind: "timeout",
    });
  });

  it("throws a safe adapter_error, rather than an unhandled rejection, when the spawn primitive itself throws unexpectedly", async () => {
    // Arrange
    const { spawn } = createFakeSpawnCodingAgentProcess({ throwError: new Error("unsafe internal detail") });
    const invoke = createProcessInvokeCodingAgent(config, spawn);

    // Act & Assert
    const rejection = expect(invoke(invocation)).rejects;
    await rejection.toBeInstanceOf(ProcessCodingAgentRuntimeError);
    await rejection.toMatchObject({ kind: "adapter_error" });
  });

  it("never includes the task title or prompt in any thrown error's message, across every failure kind", async () => {
    // Arrange
    const failureOutcomes: Array<Parameters<typeof createFakeSpawnCodingAgentProcess>[0]> = [
      { outcome: { ok: false, kind: "non_zero_exit", exitCode: 1 } },
      { outcome: { ok: false, kind: "spawn_failed", code: null } },
      { outcome: { ok: false, kind: "timeout", signal: null } },
      { throwError: new Error("unsafe-title unsafe-prompt") },
    ];

    // Act
    const messages = await Promise.all(
      failureOutcomes.map(async (behavior) => {
        const { spawn } = createFakeSpawnCodingAgentProcess(behavior);
        const invoke = createProcessInvokeCodingAgent(config, spawn);
        try {
          await invoke(invocation);
          throw new Error("expected invoke to reject");
        } catch (error) {
          return (error as Error).message;
        }
      }),
    );

    // Assert
    for (const message of messages) {
      expect(message).not.toContain("unsafe-title");
      expect(message).not.toContain("unsafe-prompt");
    }
  });
});
