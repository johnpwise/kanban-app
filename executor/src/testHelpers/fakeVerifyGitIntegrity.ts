import type { VerifyGitIntegrity, VerifyGitIntegrityRequest } from "../gitIntegrityVerification";

export function createFakeVerifyGitIntegrity(
  behavior: {
    reason?: "head_changed" | "branch_changed" | "inspection_failed";
    expectedHeadSha?: string;
    actualHeadSha?: string;
    expectedBranch?: string;
    actualBranch?: string;
    stage?: "resolve_head" | "resolve_branch";
    gitErrorCode?: number | string | null;
    throwError?: Error;
    onCall?: () => void;
  } = {},
): { verifyGitIntegrity: VerifyGitIntegrity; calls: VerifyGitIntegrityRequest[] } {
  const calls: VerifyGitIntegrityRequest[] = [];
  return {
    calls,
    verifyGitIntegrity: async (request) => {
      calls.push(request);
      behavior.onCall?.();
      if (behavior.throwError) {
        throw behavior.throwError;
      }
      if (behavior.reason === "head_changed") {
        return {
          ok: false,
          reason: "head_changed",
          expectedHeadSha: behavior.expectedHeadSha ?? request.expectedHeadSha,
          actualHeadSha: behavior.actualHeadSha ?? "b".repeat(40),
        };
      }
      if (behavior.reason === "branch_changed") {
        return {
          ok: false,
          reason: "branch_changed",
          expectedBranch: behavior.expectedBranch ?? request.expectedBranch,
          actualBranch: behavior.actualBranch ?? "coding-agent-branch",
        };
      }
      if (behavior.reason === "inspection_failed") {
        return {
          ok: false,
          reason: "inspection_failed",
          stage: behavior.stage ?? "resolve_head",
          gitErrorCode: behavior.gitErrorCode ?? null,
        };
      }
      return { ok: true, status: "verified" };
    },
  };
}
