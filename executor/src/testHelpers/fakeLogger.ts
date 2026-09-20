import type { ExecutorLogger } from "../runExecutor";

export interface FakeLoggerCall {
  level: "info" | "error";
  message: string;
  fields?: Record<string, unknown>;
}

export function createFakeLogger(): { logger: ExecutorLogger; calls: FakeLoggerCall[] } {
  const calls: FakeLoggerCall[] = [];
  return {
    calls,
    logger: {
      info: (message, fields) => {
        calls.push({ level: "info", message, fields });
      },
      error: (message, fields) => {
        calls.push({ level: "error", message, fields });
      },
    },
  };
}
