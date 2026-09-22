import type { CodingAgentInvocation, InvokeCodingAgent } from "../codingAgentInvocation";

export function createFakeInvokeCodingAgent(
  behavior: { throwError?: Error; onCall?: () => void } = {},
): { invokeCodingAgent: InvokeCodingAgent; calls: CodingAgentInvocation[] } {
  const calls: CodingAgentInvocation[] = [];
  return {
    calls,
    invokeCodingAgent: async (invocation) => {
      calls.push(invocation);
      behavior.onCall?.();
      if (behavior.throwError) {
        throw behavior.throwError;
      }
    },
  };
}
