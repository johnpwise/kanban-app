import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}));

const { runGit } = await import("./gitProcess");

describe("runGit", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("invokes the git binary via execFile with an explicit argv array and no shell option", async () => {
    // Arrange
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "ok", ""));

    // Act
    await runGit({ args: ["status"] });

    // Assert
    const [file, args, options] = execFileMock.mock.calls[0];
    expect(file).toBe("git");
    expect(Array.isArray(args)).toBe(true);
    expect(options).not.toHaveProperty("shell");
  });

  it("always disables the credential helper for this invocation", async () => {
    // Arrange
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));

    // Act
    await runGit({ args: ["clone", "https://example.invalid/repo.git", "/tmp/x"] });

    // Assert
    const [, args] = execFileMock.mock.calls[0];
    expect(args.slice(0, 2)).toEqual(["-c", "credential.helper="]);
  });

  it("appends the caller's args after the credential-helper override, unmodified", async () => {
    // Arrange
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));

    // Act
    await runGit({ args: ["checkout", "-B", "--evil", "refs/remotes/origin/--evil"] });

    // Assert
    const [, args] = execFileMock.mock.calls[0];
    expect(args).toEqual([
      "-c",
      "credential.helper=",
      "checkout",
      "-B",
      "--evil",
      "refs/remotes/origin/--evil",
    ]);
  });

  it("disables interactive credential prompting via GIT_TERMINAL_PROMPT=0", async () => {
    // Arrange
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));

    // Act
    await runGit({ args: ["status"] });

    // Assert
    const [, , options] = execFileMock.mock.calls[0];
    expect(options.env.GIT_TERMINAL_PROMPT).toBe("0");
  });

  it("bounds every invocation with an explicit timeout so a stalled network clone cannot hang forever", async () => {
    // Arrange
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));

    // Act
    await runGit({ args: ["status"] });

    // Assert
    const [, , options] = execFileMock.mock.calls[0];
    expect(options.timeout).toBeGreaterThan(0);
  });

  it("passes cwd through to execFile", async () => {
    // Arrange
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));

    // Act
    await runGit({ args: ["status"], cwd: "/tmp/workspace" });

    // Assert
    const [, , options] = execFileMock.mock.calls[0];
    expect(options.cwd).toBe("/tmp/workspace");
  });

  it("resolves ok:true with stdout on success", async () => {
    // Arrange
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "abc123\n", ""));

    // Act
    const outcome = await runGit({ args: ["rev-parse", "HEAD"] });

    // Assert
    expect(outcome).toEqual({ ok: true, stdout: "abc123\n" });
  });

  it("resolves ok:false with stderr and exit code on failure, rather than throwing", async () => {
    // Arrange
    const error = Object.assign(new Error("fatal: not a git repository"), { code: 128 });
    execFileMock.mockImplementation((_file, _args, _options, callback) =>
      callback(error, "", "fatal: not a git repository"),
    );

    // Act
    const outcome = await runGit({ args: ["status"] });

    // Assert
    expect(outcome).toEqual({ ok: false, stderr: "fatal: not a git repository", code: 128 });
  });

  it("resolves ok:false without throwing when the git binary itself cannot be spawned", async () => {
    // Arrange
    const error = Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
    execFileMock.mockImplementation((_file, _args, _options, callback) => callback(error, "", ""));

    // Act & Assert
    await expect(runGit({ args: ["status"] })).resolves.toEqual({ ok: false, stderr: "", code: "ENOENT" });
  });

  describe("env override", () => {
    it("passes through the ambient process.env by default, unchanged from today", async () => {
      // Arrange
      process.env.ADA_TEST_AMBIENT_VAR = "ambient-value";
      execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));

      try {
        // Act
        await runGit({ args: ["status"] });

        // Assert
        const [, , options] = execFileMock.mock.calls[0];
        expect(options.env.ADA_TEST_AMBIENT_VAR).toBe("ambient-value");
      } finally {
        delete process.env.ADA_TEST_AMBIENT_VAR;
      }
    });

    it("uses only the explicitly provided env when one is given, never merging in the ambient process.env", async () => {
      // Arrange
      process.env.ADA_TEST_AMBIENT_VAR = "ambient-value";
      execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));

      try {
        // Act
        await runGit({ args: ["push"], env: { PATH: "/usr/bin", CUSTOM_TOKEN_VAR: "scoped-token" } });

        // Assert
        const [, , options] = execFileMock.mock.calls[0];
        expect(options.env).toEqual({ PATH: "/usr/bin", CUSTOM_TOKEN_VAR: "scoped-token", GIT_TERMINAL_PROMPT: "0" });
        expect(options.env).not.toHaveProperty("ADA_TEST_AMBIENT_VAR");
      } finally {
        delete process.env.ADA_TEST_AMBIENT_VAR;
      }
    });

    it("still forces GIT_TERMINAL_PROMPT=0 even when an explicit env is provided", async () => {
      // Arrange
      execFileMock.mockImplementation((_file, _args, _options, callback) => callback(null, "", ""));

      // Act
      await runGit({ args: ["push"], env: { PATH: "/usr/bin" } });

      // Assert
      const [, , options] = execFileMock.mock.calls[0];
      expect(options.env.GIT_TERMINAL_PROMPT).toBe("0");
    });
  });
});
