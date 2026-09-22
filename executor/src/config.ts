import { z } from "zod";

/**
 * The environment is an untrusted runtime boundary: only `ADA_EXECUTION_RUN_ID` is accepted from
 * it. Project/Card/prompt/repository/branch are never read from the environment — the persisted
 * `executionRuns/{id}` document is the sole source of execution input. No credential fields are
 * modelled here; Firebase Admin resolves Application Default Credentials on its own.
 */
const executorConfigSchema = z.object({
  executionRunId: z
    .string()
    .min(1, "ADA_EXECUTION_RUN_ID is required.")
    .trim()
    .min(1, "ADA_EXECUTION_RUN_ID cannot be blank.")
    .refine((value) => value !== "." && value !== ".." && !value.includes("/"), {
      message: "ADA_EXECUTION_RUN_ID is not a valid Firestore document ID.",
    }),
});

export type ExecutorConfig = z.infer<typeof executorConfigSchema>;

export function parseExecutorConfig(env: Record<string, string | undefined>): ExecutorConfig {
  return executorConfigSchema.parse({ executionRunId: env.ADA_EXECUTION_RUN_ID });
}
