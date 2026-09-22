import type {
  SpawnCodingAgentProcess,
  SpawnCodingAgentProcessOutcome,
  SpawnCodingAgentProcessParams,
} from "../processCodingAgentRuntime";

export function createFakeSpawnCodingAgentProcess(
  behavior: { outcome?: SpawnCodingAgentProcessOutcome; throwError?: Error } = {},
): { spawn: SpawnCodingAgentProcess; calls: SpawnCodingAgentProcessParams[] } {
  const calls: SpawnCodingAgentProcessParams[] = [];
  return {
    calls,
    spawn: async (params) => {
      calls.push(params);
      if (behavior.throwError) {
        throw behavior.throwError;
      }
      return behavior.outcome ?? { ok: true };
    },
  };
}
