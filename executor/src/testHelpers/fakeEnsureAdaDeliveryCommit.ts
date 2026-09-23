import type { EnsureAdaDeliveryCommit, EnsureAdaDeliveryCommitRequest } from "../deliveryCommit";

export function createFakeEnsureAdaDeliveryCommit(
  behavior: {
    commitSha?: string;
    reason?:
      | "staging_failed"
      | "commit_failed"
      | "resolution_failed"
      | "head_mismatch"
      | "branch_mismatch"
      | "parent_mismatch"
      | "verification_inspection_failed";
    gitErrorCode?: number | string | null;
    expectedCommitSha?: string;
    actualHeadSha?: string;
    expectedBranch?: string;
    actualBranch?: string;
    expectedParentSha?: string;
    actualParentSha?: string;
    stage?: "resolve_head" | "resolve_branch" | "resolve_parent";
    throwError?: Error;
    onCall?: () => void;
  } = {},
): { ensureAdaDeliveryCommit: EnsureAdaDeliveryCommit; calls: EnsureAdaDeliveryCommitRequest[] } {
  const calls: EnsureAdaDeliveryCommitRequest[] = [];
  return {
    calls,
    ensureAdaDeliveryCommit: async (request) => {
      calls.push(request);
      behavior.onCall?.();
      if (behavior.throwError) {
        throw behavior.throwError;
      }
      if (behavior.reason === "staging_failed") {
        return { ok: false, reason: "staging_failed", gitErrorCode: behavior.gitErrorCode ?? 128 };
      }
      if (behavior.reason === "commit_failed") {
        return { ok: false, reason: "commit_failed", gitErrorCode: behavior.gitErrorCode ?? 1 };
      }
      if (behavior.reason === "resolution_failed") {
        return { ok: false, reason: "resolution_failed", gitErrorCode: behavior.gitErrorCode ?? 128 };
      }
      if (behavior.reason === "head_mismatch") {
        return {
          ok: false,
          reason: "head_mismatch",
          expectedCommitSha: behavior.expectedCommitSha ?? "c".repeat(40),
          actualHeadSha: behavior.actualHeadSha ?? "f".repeat(40),
        };
      }
      if (behavior.reason === "branch_mismatch") {
        return {
          ok: false,
          reason: "branch_mismatch",
          expectedBranch: behavior.expectedBranch ?? request.expectedBranch,
          actualBranch: behavior.actualBranch ?? "coding-agent-branch",
        };
      }
      if (behavior.reason === "parent_mismatch") {
        return {
          ok: false,
          reason: "parent_mismatch",
          expectedParentSha: behavior.expectedParentSha ?? request.expectedParentSha,
          actualParentSha: behavior.actualParentSha ?? "e".repeat(40),
        };
      }
      if (behavior.reason === "verification_inspection_failed") {
        return {
          ok: false,
          reason: "verification_inspection_failed",
          stage: behavior.stage ?? "resolve_head",
          gitErrorCode: behavior.gitErrorCode ?? 128,
        };
      }
      return { ok: true, commitSha: behavior.commitSha ?? "c".repeat(40) };
    },
  };
}
