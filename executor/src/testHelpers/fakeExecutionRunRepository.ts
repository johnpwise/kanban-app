import type { ExecutionRunRepository } from "../executionRunRepository";

export interface FakeExecutionRunRepositoryCall {
  executionRunId: string;
}

export function createFakeExecutionRunRepository(
  behavior: { data?: unknown; throwError?: Error },
): { repository: ExecutionRunRepository; calls: FakeExecutionRunRepositoryCall[] } {
  const calls: FakeExecutionRunRepositoryCall[] = [];
  return {
    calls,
    repository: {
      async loadExecutionRunData(executionRunId: string) {
        calls.push({ executionRunId });
        if (behavior.throwError) {
          throw behavior.throwError;
        }
        return behavior.data;
      },
    },
  };
}
