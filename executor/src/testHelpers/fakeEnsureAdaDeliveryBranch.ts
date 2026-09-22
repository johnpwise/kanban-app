import type { EnsureAdaDeliveryBranch, EnsureAdaDeliveryBranchRequest } from "../deliveryBranch";

export function createFakeEnsureAdaDeliveryBranch(
  behavior: {
    branchName?: string;
    reason?:
      | "invalid_branch_name"
      | "branch_creation_failed"
      | "branch_verification_failed"
      | "branch_verification_inspection_failed";
    gitErrorCode?: number | string | null;
    expectedBranch?: string;
    actualBranch?: string;
    throwError?: Error;
    onCall?: () => void;
  } = {},
): { ensureAdaDeliveryBranch: EnsureAdaDeliveryBranch; calls: EnsureAdaDeliveryBranchRequest[] } {
  const calls: EnsureAdaDeliveryBranchRequest[] = [];
  return {
    calls,
    ensureAdaDeliveryBranch: async (request) => {
      calls.push(request);
      behavior.onCall?.();
      if (behavior.throwError) {
        throw behavior.throwError;
      }
      if (behavior.reason === "invalid_branch_name") {
        return { ok: false, reason: "invalid_branch_name", gitErrorCode: behavior.gitErrorCode ?? 1 };
      }
      if (behavior.reason === "branch_creation_failed") {
        return { ok: false, reason: "branch_creation_failed", gitErrorCode: behavior.gitErrorCode ?? 128 };
      }
      if (behavior.reason === "branch_verification_failed") {
        return {
          ok: false,
          reason: "branch_verification_failed",
          expectedBranch: behavior.expectedBranch ?? `ada/${request.executionRequestId}`,
          actualBranch: behavior.actualBranch ?? "coding-agent-branch",
        };
      }
      if (behavior.reason === "branch_verification_inspection_failed") {
        return { ok: false, reason: "branch_verification_inspection_failed", gitErrorCode: behavior.gitErrorCode ?? 128 };
      }
      return { ok: true, branchName: behavior.branchName ?? `ada/${request.executionRequestId}` };
    },
  };
}
