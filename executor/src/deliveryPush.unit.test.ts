import { describe, expect, it } from "vitest";

import { buildDeliveryPushUrl, ensureAdaDeliveryPush } from "./deliveryPush";

import type { MintGithubDeliveryCredential } from "./githubAppCredential";
import type { RunGit, RunGitParams } from "./gitProcess";

function fakeMintCredential(
  behavior:
    | { ok: true; token?: string }
    | { ok: false; reason: "config_invalid" | "jwt_signing_failed" | "token_exchange_failed" | "token_exchange_network_error"; httpStatus?: number },
): MintGithubDeliveryCredential {
  return async () => {
    if (behavior.ok) {
      return { ok: true, token: behavior.token ?? "distinctive-installation-token", expiresAt: "2026-09-23T13:00:00Z" };
    }
    if (behavior.reason === "token_exchange_failed") {
      return { ok: false, reason: "token_exchange_failed", httpStatus: behavior.httpStatus };
    }
    return { ok: false, reason: behavior.reason };
  };
}

function recordingRunGit(byArgsPrefix: Record<string, { ok: true; stdout: string } | { ok: false; code: number | string | null }>): {
  runGit: RunGit;
  calls: RunGitParams[];
} {
  const calls: RunGitParams[] = [];
  return {
    calls,
    runGit: async (params) => {
      calls.push(params);
      const key = params.args[0];
      const outcome = byArgsPrefix[key];
      if (!outcome) {
        return { ok: false, stderr: "fatal: unsafe stderr detail that must never be logged", code: 1 };
      }
      if (outcome.ok) {
        return { ok: true, stdout: outcome.stdout };
      }
      return { ok: false, stderr: "fatal: unsafe stderr detail that must never be logged", code: outcome.code };
    },
  };
}

const BASE_REQUEST = {
  workspacePath: "/tmp/ada-workspace",
  repository: "johnpwise/kanban-app",
  deliveryBranch: "ada/exec-request-1",
  deliveryCommitSha: "c".repeat(40),
};

describe("buildDeliveryPushUrl", () => {
  it("derives the push URL from the validated repository identity, not the workspace's configured origin", () => {
    // Act
    const url = buildDeliveryPushUrl("johnpwise/kanban-app");

    // Assert
    expect(url).toBe("https://github.com/johnpwise/kanban-app.git");
  });
});

describe("ensureAdaDeliveryPush", () => {
  it("returns credential_unavailable and never calls runGit when credential minting fails", async () => {
    // Arrange
    const mintCredential = fakeMintCredential({ ok: false, reason: "token_exchange_failed", httpStatus: 401 });
    const { runGit, calls } = recordingRunGit({});

    // Act
    const result = await ensureAdaDeliveryPush({ ...BASE_REQUEST, env: {}, mintCredential, runGit });

    // Assert
    expect(result).toEqual({ ok: false, reason: "credential_unavailable", credentialReason: "token_exchange_failed", httpStatus: 401 });
    expect(calls).toHaveLength(0);
  });

  it("returns push_failed with the safe git error code when the push itself fails", async () => {
    // Arrange
    const mintCredential = fakeMintCredential({ ok: true });
    const { runGit } = recordingRunGit({ push: { ok: false, code: 1 } });

    // Act
    const result = await ensureAdaDeliveryPush({ ...BASE_REQUEST, env: {}, mintCredential, runGit });

    // Assert
    expect(result).toEqual({ ok: false, reason: "push_failed", gitErrorCode: 1 });
  });

  it("pushes the exact deliveryCommitSha to refs/heads/<deliveryBranch> without --force", async () => {
    // Arrange
    const mintCredential = fakeMintCredential({ ok: true });
    const { runGit, calls } = recordingRunGit({
      push: { ok: true, stdout: "" },
      "ls-remote": { ok: true, stdout: `${BASE_REQUEST.deliveryCommitSha}\trefs/heads/${BASE_REQUEST.deliveryBranch}\n` },
    });

    // Act
    await ensureAdaDeliveryPush({ ...BASE_REQUEST, env: {}, mintCredential, runGit });

    // Assert
    const pushCall = calls.find((call) => call.args[0] === "push");
    expect(pushCall?.args).toEqual([
      "push",
      "--no-verify",
      "https://github.com/johnpwise/kanban-app.git",
      `${BASE_REQUEST.deliveryCommitSha}:refs/heads/${BASE_REQUEST.deliveryBranch}`,
    ]);
    expect(pushCall?.args).not.toContain("--force");
    expect(pushCall?.args).not.toContain("-f");
  });

  it("never places the credential token in git argv", async () => {
    // Arrange
    const mintCredential = fakeMintCredential({ ok: true, token: "should-never-appear-in-argv" });
    const { runGit, calls } = recordingRunGit({
      push: { ok: true, stdout: "" },
      "ls-remote": { ok: true, stdout: `${BASE_REQUEST.deliveryCommitSha}\trefs/heads/${BASE_REQUEST.deliveryBranch}\n` },
    });

    // Act
    await ensureAdaDeliveryPush({ ...BASE_REQUEST, env: {}, mintCredential, runGit });

    // Assert
    for (const call of calls) {
      expect(call.args.join(" ")).not.toContain("should-never-appear-in-argv");
    }
  });

  it("scopes the credential to the push/ls-remote env, never merging in the ambient process.env", async () => {
    // Arrange
    const mintCredential = fakeMintCredential({ ok: true, token: "distinctive-installation-token" });
    const { runGit, calls } = recordingRunGit({
      push: { ok: true, stdout: "" },
      "ls-remote": { ok: true, stdout: `${BASE_REQUEST.deliveryCommitSha}\trefs/heads/${BASE_REQUEST.deliveryBranch}\n` },
    });

    // Act
    await ensureAdaDeliveryPush({
      ...BASE_REQUEST,
      env: { PATH: "/usr/bin", HOME: "/home/ada", UNRELATED_SECRET: "must-not-leak" },
      mintCredential,
      runGit,
    });

    // Assert
    const pushCall = calls.find((call) => call.args[0] === "push");
    expect(pushCall?.env?.PATH).toBe("/usr/bin");
    expect(pushCall?.env?.HOME).toBe("/home/ada");
    expect(pushCall?.env?.ADA_GIT_ASKPASS_TOKEN).toBe("distinctive-installation-token");
    expect(typeof pushCall?.env?.GIT_ASKPASS).toBe("string");
    expect(pushCall?.env).not.toHaveProperty("UNRELATED_SECRET");
  });

  it("returns remote_verification_failed with the safe git error code when ls-remote fails", async () => {
    // Arrange
    const mintCredential = fakeMintCredential({ ok: true });
    const { runGit } = recordingRunGit({
      push: { ok: true, stdout: "" },
      "ls-remote": { ok: false, code: 128 },
    });

    // Act
    const result = await ensureAdaDeliveryPush({ ...BASE_REQUEST, env: {}, mintCredential, runGit });

    // Assert
    expect(result).toEqual({ ok: false, reason: "remote_verification_failed", gitErrorCode: 128 });
  });

  it("returns remote_ref_not_found when ls-remote succeeds but resolves nothing", async () => {
    // Arrange
    const mintCredential = fakeMintCredential({ ok: true });
    const { runGit } = recordingRunGit({
      push: { ok: true, stdout: "" },
      "ls-remote": { ok: true, stdout: "" },
    });

    // Act
    const result = await ensureAdaDeliveryPush({ ...BASE_REQUEST, env: {}, mintCredential, runGit });

    // Assert
    expect(result).toEqual({ ok: false, reason: "remote_ref_not_found" });
  });

  it("returns remote_sha_mismatch — never trusting the push exit code alone — when the independently resolved SHA differs", async () => {
    // Arrange
    const mintCredential = fakeMintCredential({ ok: true });
    const divergedSha = "d".repeat(40);
    const { runGit } = recordingRunGit({
      push: { ok: true, stdout: "" },
      "ls-remote": { ok: true, stdout: `${divergedSha}\trefs/heads/${BASE_REQUEST.deliveryBranch}\n` },
    });

    // Act
    const result = await ensureAdaDeliveryPush({ ...BASE_REQUEST, env: {}, mintCredential, runGit });

    // Assert
    expect(result).toEqual({
      ok: false,
      reason: "remote_sha_mismatch",
      expectedSha: BASE_REQUEST.deliveryCommitSha,
      actualSha: divergedSha,
    });
  });

  it("returns ok:true with the verified remote branch and sha on success", async () => {
    // Arrange
    const mintCredential = fakeMintCredential({ ok: true });
    const { runGit } = recordingRunGit({
      push: { ok: true, stdout: "" },
      "ls-remote": { ok: true, stdout: `${BASE_REQUEST.deliveryCommitSha}\trefs/heads/${BASE_REQUEST.deliveryBranch}\n` },
    });

    // Act
    const result = await ensureAdaDeliveryPush({ ...BASE_REQUEST, env: {}, mintCredential, runGit });

    // Assert
    expect(result).toEqual({ ok: true, remoteBranch: BASE_REQUEST.deliveryBranch, remoteSha: BASE_REQUEST.deliveryCommitSha });
  });
});
