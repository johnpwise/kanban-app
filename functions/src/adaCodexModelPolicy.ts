import { z } from "zod";

/**
 * The only Codex models currently approved for **automatic** ADA execution launches. Mirrors
 * `executor/deploy/deploy.sh`'s `ALLOWED_CODEX_MODELS` — kept as a small, explicit duplicate (not a
 * shared package across the `functions`/`executor`/bash boundary) per the deliberate scope decision
 * for this slice. Extend both arrays together when a new model is approved.
 */
export const ALLOWED_CODEX_MODELS = ["gpt-5.6-luna", "gpt-5.6-terra"] as const;

/**
 * Mirrors `executor/deploy/deploy.sh`'s `ALLOWED_CODEX_REASONING_EFFORTS` — a deliberately narrower,
 * currently-approved subset of the full `low|medium|high|xhigh|max` that
 * `executor/src/codexProviderConfig.ts`'s `CODEX_REASONING_EFFORT` schema accepts. Extend alongside
 * both of those when a new effort level is approved for automatic launches.
 */
export const ALLOWED_CODEX_REASONING_EFFORTS = ["low", "medium", "high"] as const;

/**
 * Thrown when the automatic launcher's model configuration is missing, blank, or outside the
 * approved allow-list. Carries no secret or task-prompt content — only the safe field name and
 * value that failed — and is recognized by `launchExecutionRun.ts`'s `classifyLaunchError` so a
 * fail-closed config error is acknowledged rather than retried forever.
 */
export class AdaCodexModelConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdaCodexModelConfigError";
  }
}

const adaCodexModelConfigSchema = z.object({
  codexModel: z.enum(ALLOWED_CODEX_MODELS, {
    error: () => `CODEX_MODEL must be one of: ${ALLOWED_CODEX_MODELS.join(", ")}.`,
  }),
  codexReasoningEffort: z
    .enum(ALLOWED_CODEX_REASONING_EFFORTS, {
      error: () => `CODEX_REASONING_EFFORT must be one of: ${ALLOWED_CODEX_REASONING_EFFORTS.join(", ")}.`,
    })
    .optional(),
});

export type AdaCodexModelConfig = z.infer<typeof adaCodexModelConfigSchema>;

/**
 * Validates the automatic launcher's approved model configuration. An unset/blank `codexModel`
 * fails closed rather than silently omitting `CODEX_MODEL` (which would let the executor fall back
 * to no model, itself already rejected by `codexProviderConfig.ts`, but only after the Cloud Run
 * Job has already been launched). A blank `codexReasoningEffort` is treated as "not configured" and
 * omitted from the result, matching the executor's own optional-`CODEX_REASONING_EFFORT` contract.
 */
export function parseAdaCodexModelConfig(input: {
  codexModel: string | undefined;
  codexReasoningEffort: string | undefined;
}): AdaCodexModelConfig {
  const trimmedModel = input.codexModel?.trim();
  const trimmedEffort = input.codexReasoningEffort?.trim();

  const result = adaCodexModelConfigSchema.safeParse({
    codexModel: trimmedModel === "" ? undefined : trimmedModel,
    codexReasoningEffort: trimmedEffort === "" ? undefined : trimmedEffort,
  });

  if (!result.success) {
    throw new AdaCodexModelConfigError(result.error.issues.map((issue) => issue.message).join(" "));
  }

  return result.data;
}
