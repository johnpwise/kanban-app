import type { CreateOrReuseAdaPullRequest, CreateOrReuseAdaPullRequestRequest } from "../adaPullRequest";

export function createFakeCreateOrReuseAdaPullRequest(
  behavior: {
    status?: "created" | "existing";
    number?: number;
    htmlUrl?: string;
    reason?: "credential_unavailable" | "lookup_failed" | "lookup_network_error" | "create_failed" | "create_network_error";
    credentialReason?: "config_invalid" | "jwt_signing_failed" | "token_exchange_failed" | "token_exchange_network_error";
    httpStatus?: number;
    throwError?: Error;
    onCall?: () => void;
  } = {},
): { createOrReuseAdaPullRequest: CreateOrReuseAdaPullRequest; calls: CreateOrReuseAdaPullRequestRequest[] } {
  const calls: CreateOrReuseAdaPullRequestRequest[] = [];
  return {
    calls,
    createOrReuseAdaPullRequest: async (request) => {
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
      if (behavior.reason === "lookup_failed") {
        return { ok: false, reason: "lookup_failed", httpStatus: behavior.httpStatus ?? 401 };
      }
      if (behavior.reason === "lookup_network_error") {
        return { ok: false, reason: "lookup_network_error" };
      }
      if (behavior.reason === "create_failed") {
        return { ok: false, reason: "create_failed", httpStatus: behavior.httpStatus ?? 422 };
      }
      if (behavior.reason === "create_network_error") {
        return { ok: false, reason: "create_network_error" };
      }
      const number = behavior.number ?? 42;
      const htmlUrl = behavior.htmlUrl ?? "https://github.com/johnpwise/kanban-app/pull/42";
      if (behavior.status === "existing") {
        return { ok: true, status: "existing", number, htmlUrl };
      }
      return { ok: true, status: "created", number, htmlUrl };
    },
  };
}
