import type { InspectWorkingTree, InspectWorkingTreeRequest, WorkingTreeStatus } from "../workingTreeInspection";

export function createFakeInspectWorkingTree(
  behavior: {
    status?: WorkingTreeStatus;
    reason?: "status_failed";
    gitErrorCode?: number | string | null;
    throwError?: Error;
    onCall?: () => void;
  } = {},
): { inspectWorkingTree: InspectWorkingTree; calls: InspectWorkingTreeRequest[] } {
  const calls: InspectWorkingTreeRequest[] = [];
  return {
    calls,
    inspectWorkingTree: async (request) => {
      calls.push(request);
      behavior.onCall?.();
      if (behavior.throwError) {
        throw behavior.throwError;
      }
      if (behavior.reason === "status_failed") {
        return { ok: false, reason: "status_failed", gitErrorCode: behavior.gitErrorCode ?? null };
      }
      return { ok: true, status: behavior.status ?? "clean" };
    },
  };
}
