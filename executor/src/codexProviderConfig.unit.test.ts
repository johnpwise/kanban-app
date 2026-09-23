import { describe, expect, it } from "vitest";

import { parseCodexProviderConfig } from "./codexProviderConfig";

describe("parseCodexProviderConfig", () => {
  it("builds the constrained, unattended Codex invocation from a valid CODEX_API_KEY", () => {
    // Arrange
    const env = { CODEX_API_KEY: "test-key", CODEX_MODEL: "gpt-5-codex" };

    // Act
    const result = parseCodexProviderConfig(env);

    // Assert
    expect(result.command).toBe("codex");
    // `--ask-for-approval` is a top-level `codex` flag, not a flag of the `exec` subcommand —
    // it must precede `exec`, or the CLI's arg parser rejects it and exits with a usage error.
    expect(result.args).toEqual([
      "--ask-for-approval",
      "never",
      "exec",
      "-",
      "--sandbox",
      "workspace-write",
      "--model",
      "gpt-5-codex",
    ]);
    expect(result.timeoutMs).toBe(600_000);
  });

  it("rejects a missing CODEX_API_KEY", () => {
    // Arrange
    const env = {};

    // Act
    const act = () => parseCodexProviderConfig(env);

    // Assert
    expect(act).toThrow();
  });

  it("rejects a blank CODEX_API_KEY", () => {
    // Arrange
    const env = { CODEX_API_KEY: "   " };

    // Act
    const act = () => parseCodexProviderConfig(env);

    // Assert
    expect(act).toThrow();
  });

  it("rejects a missing CODEX_MODEL", () => {
    // Arrange
    const env = { CODEX_API_KEY: "test-key" };

    // Act
    const act = () => parseCodexProviderConfig(env);

    // Assert
    expect(act).toThrow();
  });

  it("rejects a blank CODEX_MODEL", () => {
    // Arrange
    const env = { CODEX_API_KEY: "test-key", CODEX_MODEL: "   " };

    // Act
    const act = () => parseCodexProviderConfig(env);

    // Assert
    expect(act).toThrow();
  });

  it("honors a CODEX_COMMAND override", () => {
    // Arrange
    const env = { CODEX_API_KEY: "test-key", CODEX_MODEL: "gpt-5-codex", CODEX_COMMAND: "/opt/codex/bin/codex" };

    // Act
    const result = parseCodexProviderConfig(env);

    // Assert
    expect(result.command).toBe("/opt/codex/bin/codex");
  });

  it("appends --model when CODEX_MODEL is set", () => {
    // Arrange
    const env = { CODEX_API_KEY: "test-key", CODEX_MODEL: "gpt-5-codex" };

    // Act
    const result = parseCodexProviderConfig(env);

    // Assert
    expect(result.args.slice(-2)).toEqual(["--model", "gpt-5-codex"]);
  });

  it("honors a valid CODEX_TIMEOUT_MS override", () => {
    // Arrange
    const env = { CODEX_API_KEY: "test-key", CODEX_MODEL: "gpt-5-codex", CODEX_TIMEOUT_MS: "60000" };

    // Act
    const result = parseCodexProviderConfig(env);

    // Assert
    expect(result.timeoutMs).toBe(60_000);
  });

  it("rejects a non-numeric CODEX_TIMEOUT_MS", () => {
    // Arrange
    const env = { CODEX_API_KEY: "test-key", CODEX_MODEL: "gpt-5-codex", CODEX_TIMEOUT_MS: "not-a-number" };

    // Act
    const act = () => parseCodexProviderConfig(env);

    // Assert
    expect(act).toThrow();
  });

  it("rejects a zero or negative CODEX_TIMEOUT_MS", () => {
    // Arrange
    const env = { CODEX_API_KEY: "test-key", CODEX_MODEL: "gpt-5-codex", CODEX_TIMEOUT_MS: "0" };

    // Act
    const act = () => parseCodexProviderConfig(env);

    // Assert
    expect(act).toThrow();
  });

  describe("CODEX_REASONING_EFFORT", () => {
    it("passes -c model_reasoning_effort=<value> through to the args when set to an accepted value", () => {
      // Arrange
      const env = { CODEX_API_KEY: "test-key", CODEX_MODEL: "gpt-5-codex", CODEX_REASONING_EFFORT: "xhigh" };

      // Act
      const result = parseCodexProviderConfig(env);

      // Assert
      expect(result.args.slice(-2)).toEqual(["-c", "model_reasoning_effort=xhigh"]);
    });

    it("omits the -c model_reasoning_effort flag when CODEX_REASONING_EFFORT is unset", () => {
      // Arrange
      const env = { CODEX_API_KEY: "test-key", CODEX_MODEL: "gpt-5-codex" };

      // Act
      const result = parseCodexProviderConfig(env);

      // Assert
      expect(result.args).not.toContain("-c");
      expect(result.args.join(" ")).not.toContain("model_reasoning_effort");
    });

    it("rejects a CODEX_REASONING_EFFORT value outside the Codex CLI's accepted set", () => {
      // Arrange
      const env = { CODEX_API_KEY: "test-key", CODEX_MODEL: "gpt-5-codex", CODEX_REASONING_EFFORT: "ultra" };

      // Act
      const act = () => parseCodexProviderConfig(env);

      // Assert
      expect(act).toThrow();
    });
  });

  describe("credential isolation", () => {
    it("includes CODEX_API_KEY in the resulting child-process env", () => {
      // Arrange
      const env = { CODEX_API_KEY: "distinctive-secret-value", CODEX_MODEL: "gpt-5-codex" };

      // Act
      const result = parseCodexProviderConfig(env);

      // Assert
      expect(result.env.CODEX_API_KEY).toBe("distinctive-secret-value");
    });

    it("never passes through unrelated process env vars into the child-process env", () => {
      // Arrange
      const env = {
        CODEX_API_KEY: "test-key",
        CODEX_MODEL: "gpt-5-codex",
        PATH: "/usr/bin",
        HOME: "/home/node",
        UNRELATED_SECRET: "should-not-leak-to-child",
        FIRESTORE_EMULATOR_HOST: "localhost:8080",
      };

      // Act
      const result = parseCodexProviderConfig(env);

      // Assert
      expect(Object.keys(result.env).sort()).toEqual(["CODEX_API_KEY", "HOME", "PATH"]);
      expect(result.env).not.toHaveProperty("UNRELATED_SECRET");
      expect(result.env).not.toHaveProperty("FIRESTORE_EMULATOR_HOST");
    });

    it("never passes the ADA GitHub delivery credential (App ID, private key, installation id) through to the coding-agent env", () => {
      // Arrange — the executor's ambient process.env may legitimately hold the GitHub delivery
      // credential (read by the separate `githubAppCredential.ts` module for the push step), but
      // it must never reach the coding-agent child process spawned from this config.
      const env = {
        CODEX_API_KEY: "test-key",
        CODEX_MODEL: "gpt-5-codex",
        PATH: "/usr/bin",
        HOME: "/home/node",
        ADA_GITHUB_APP_ID: "123456",
        ADA_GITHUB_APP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\ndistinctive-key-material\n-----END PRIVATE KEY-----",
        ADA_GITHUB_APP_INSTALLATION_ID: "987654",
      };

      // Act
      const result = parseCodexProviderConfig(env);

      // Assert
      expect(Object.keys(result.env).sort()).toEqual(["CODEX_API_KEY", "HOME", "PATH"]);
      expect(result.env).not.toHaveProperty("ADA_GITHUB_APP_ID");
      expect(result.env).not.toHaveProperty("ADA_GITHUB_APP_PRIVATE_KEY");
      expect(result.env).not.toHaveProperty("ADA_GITHUB_APP_INSTALLATION_ID");
      expect(JSON.stringify(result.env)).not.toContain("distinctive-key-material");
    });

    it("never includes the CODEX_API_KEY value in a thrown validation error's message", () => {
      // Arrange
      const env = { CODEX_API_KEY: "distinctive-secret-value", CODEX_TIMEOUT_MS: "not-a-number" };

      // Act & Assert
      try {
        parseCodexProviderConfig(env);
        throw new Error("expected parseCodexProviderConfig to throw");
      } catch (error) {
        expect((error as Error).message).not.toContain("distinctive-secret-value");
      }
    });
  });
});
