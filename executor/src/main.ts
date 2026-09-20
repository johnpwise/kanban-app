import { createFirestoreExecutionRunRepository } from "./executionRunRepository";
import { exitCodeForOutcome } from "./exitCode";
import { runExecutor } from "./runExecutor";

import type { ExecutorLogger } from "./runExecutor";

/**
 * Structured stdout/stderr logger. Cloud Run/Cloud Logging parse JSON log lines automatically;
 * fields passed here must already be limited to safe identifiers by the caller (`runExecutor`).
 */
const jsonLogger: ExecutorLogger = {
  info(message, fields) {
    console.log(JSON.stringify({ severity: "INFO", message, ...fields }));
  },
  error(message, fields) {
    console.error(JSON.stringify({ severity: "ERROR", message, ...fields }));
  },
};

/**
 * The only place in this package that reads `process.env` for real or calls `process.exit`.
 * Kept intentionally thin: all branching logic lives in the fully unit-tested `runExecutor`.
 */
async function main(): Promise<void> {
  const outcome = await runExecutor({
    env: process.env,
    repository: createFirestoreExecutionRunRepository(),
    logger: jsonLogger,
  });
  process.exit(exitCodeForOutcome(outcome));
}

main().catch((error: unknown) => {
  jsonLogger.error("Unhandled executor failure.", {
    error: error instanceof Error ? error.message : "unknown error",
  });
  process.exit(1);
});
