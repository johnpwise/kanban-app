import type { MaterializeRepositoryWorkspace, RepositoryWorkspaceRequest } from "../repositoryWorkspace";

export function createFakeMaterializeRepositoryWorkspace(
  behavior: {
    reason?: "workspace_create_failed" | "clone_failed" | "checkout_failed";
    throwError?: Error;
    headSha?: string;
  } = {},
): {
  materializeRepositoryWorkspace: MaterializeRepositoryWorkspace;
  calls: RepositoryWorkspaceRequest[];
  cleanupCallCount: () => number;
} {
  const calls: RepositoryWorkspaceRequest[] = [];
  let cleanupCalls = 0;
  return {
    calls,
    cleanupCallCount: () => cleanupCalls,
    materializeRepositoryWorkspace: async (request) => {
      calls.push(request);
      if (behavior.throwError) {
        throw behavior.throwError;
      }
      if (behavior.reason) {
        return { ok: false, reason: behavior.reason };
      }
      return {
        ok: true,
        workspace: { path: "/tmp/fake-workspace", headSha: behavior.headSha ?? "a".repeat(40) },
        cleanup: async () => {
          cleanupCalls += 1;
        },
      };
    },
  };
}
