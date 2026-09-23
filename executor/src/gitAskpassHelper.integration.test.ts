import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import { createGitAskpassScript, removeGitAskpassScript } from "./gitAskpassHelper";

const execFileAsync = promisify(execFile);

describe("createGitAskpassScript / removeGitAskpassScript", () => {
  const createdPaths: string[] = [];

  afterEach(async () => {
    while (createdPaths.length > 0) {
      const path = createdPaths.pop();
      if (path) {
        await removeGitAskpassScript(path);
      }
    }
  });

  it("writes an executable script, owner-only permissioned", async () => {
    // Act
    const outcome = await createGitAskpassScript();
    if (outcome.ok) createdPaths.push(outcome.scriptPath);

    // Assert
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const stats = await stat(outcome.scriptPath);
    expect(stats.mode & 0o777).toBe(0o700);
  });

  it("prints x-access-token when invoked with a Username prompt, regardless of the token env var", async () => {
    // Arrange
    const outcome = await createGitAskpassScript();
    if (outcome.ok) createdPaths.push(outcome.scriptPath);
    if (!outcome.ok) throw new Error("expected script creation to succeed");

    // Act
    const { stdout } = await execFileAsync("node", [outcome.scriptPath, "Username for 'https://github.com': "], {
      env: { PATH: process.env.PATH, ADA_GIT_ASKPASS_TOKEN: "should-not-appear-for-username-prompt" },
    });

    // Assert
    expect(stdout).toBe("x-access-token");
  });

  it("prints the token from ADA_GIT_ASKPASS_TOKEN when invoked with a Password prompt", async () => {
    // Arrange
    const outcome = await createGitAskpassScript();
    if (outcome.ok) createdPaths.push(outcome.scriptPath);
    if (!outcome.ok) throw new Error("expected script creation to succeed");

    // Act
    const { stdout } = await execFileAsync("node", [outcome.scriptPath, "Password for 'https://x-access-token@github.com': "], {
      env: { PATH: process.env.PATH, ADA_GIT_ASKPASS_TOKEN: "distinctive-test-token" },
    });

    // Assert
    expect(stdout).toBe("distinctive-test-token");
  });

  it("prints an empty string for a Password prompt when no token env var is set, never throwing", async () => {
    // Arrange
    const outcome = await createGitAskpassScript();
    if (outcome.ok) createdPaths.push(outcome.scriptPath);
    if (!outcome.ok) throw new Error("expected script creation to succeed");

    // Act
    const { stdout } = await execFileAsync("node", [outcome.scriptPath, "Password for 'https://x-access-token@github.com': "], {
      env: { PATH: process.env.PATH },
    });

    // Assert
    expect(stdout).toBe("");
  });

  it("removeGitAskpassScript deletes the script and is safe to call on an already-removed path", async () => {
    // Arrange
    const outcome = await createGitAskpassScript();
    if (!outcome.ok) throw new Error("expected script creation to succeed");

    // Act
    await removeGitAskpassScript(outcome.scriptPath);
    await expect(stat(outcome.scriptPath)).rejects.toThrow();

    // Act again — must not throw when the file is already gone
    await expect(removeGitAskpassScript(outcome.scriptPath)).resolves.toBeUndefined();
  });

  it("writes each script to a distinct path", async () => {
    // Act
    const first = await createGitAskpassScript();
    const second = await createGitAskpassScript();
    if (first.ok) createdPaths.push(first.scriptPath);
    if (second.ok) createdPaths.push(second.scriptPath);

    // Assert
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.scriptPath).not.toBe(second.scriptPath);
    }
  });
});
