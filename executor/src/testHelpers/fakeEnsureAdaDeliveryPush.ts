import type { EnsureAdaDeliveryPush, EnsureAdaDeliveryPushRequest } from "../deliveryPush";

export function createFakeEnsureAdaDeliveryPush(
  behavior: {
    remoteBranch?: string;
    remoteSha?: string;
    reason?:
      | "credential_unavailable"
      | "askpass_setup_failed"
      | "push_failed"
      | "remote_verification_failed"
      | "remote_ref_not_found"
      | "remote_sha_mismatch";
    credentialReason?: "config_invalid" | "jwt_signing_failed" | "token_exchange_failed" | "token_exchange_network_error";
    httpStatus?: number;
    gitErrorCode?: number | string | null;
    expectedSha?: string;
    actualSha?: string;
    throwError?: Error;
    onCall?: () => void;
  } = {},
): { ensureAdaDeliveryPush: EnsureAdaDeliveryPush; calls: EnsureAdaDeliveryPushRequest[] } {
  const calls: EnsureAdaDeliveryPushRequest[] = [];
  return {
    calls,
    ensureAdaDeliveryPush: async (request) => {
      calls.push(request);
      behavior.onCall?.();
      if (behavior.throwError) {
        throw behavior.throwError;
      }
      if (behavior.reason === "credential_unavailable") {
        return {
          ok: false,
          reason: "credential_unavailable",
          credentialReason: behavior.credentialReason ?? "token_exchange_failed",
          ...(behavior.httpStatus !== undefined ? { httpStatus: behavior.httpStatus } : {}),
        };
      }
      if (behavior.reason === "askpass_setup_failed") {
        return { ok: false, reason: "askpass_setup_failed" };
      }
      if (behavior.reason === "push_failed") {
        return { ok: false, reason: "push_failed", gitErrorCode: behavior.gitErrorCode ?? 1 };
      }
      if (behavior.reason === "remote_verification_failed") {
        return { ok: false, reason: "remote_verification_failed", gitErrorCode: behavior.gitErrorCode ?? 128 };
      }
      if (behavior.reason === "remote_ref_not_found") {
        return { ok: false, reason: "remote_ref_not_found" };
      }
      if (behavior.reason === "remote_sha_mismatch") {
        return {
          ok: false,
          reason: "remote_sha_mismatch",
          expectedSha: behavior.expectedSha ?? request.deliveryCommitSha,
          actualSha: behavior.actualSha ?? "e".repeat(40),
        };
      }
      return {
        ok: true,
        remoteBranch: behavior.remoteBranch ?? request.deliveryBranch,
        remoteSha: behavior.remoteSha ?? request.deliveryCommitSha,
      };
    },
  };
}
