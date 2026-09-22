import type { RunDownstreamWork } from "../downstreamWork";

export interface FakeRunDownstreamWorkCall {
  workspacePath: string;
  headSha: string;
}

export function createFakeRunDownstreamWork(
  behavior: { throwError?: Error; onCall?: () => void } = {},
): { runDownstreamWork: RunDownstreamWork; calls: FakeRunDownstreamWorkCall[] } {
  const calls: FakeRunDownstreamWorkCall[] = [];
  return {
    calls,
    runDownstreamWork: async (context) => {
      calls.push(context);
      behavior.onCall?.();
      if (behavior.throwError) {
        throw behavior.throwError;
      }
    },
  };
}
