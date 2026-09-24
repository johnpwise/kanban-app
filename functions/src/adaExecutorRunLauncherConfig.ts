import { defineString } from "firebase-functions/params";

/**
 * GCP project, region, and Cloud Run Job name for the ada-executor launcher. Names and defaults
 * mirror the ones already established for the executor's own deploy tooling
 * (executor/deploy/config.env.example) so operators recognize the same identifiers across both
 * places, and can be overridden per environment without a code change.
 */
export const adaGcpProjectId = defineString("ADA_GCP_PROJECT_ID", { default: "kanban-app-fa4b7" });
export const adaGcpRegion = defineString("ADA_GCP_REGION", { default: "europe-west2" });
export const adaJobName = defineString("ADA_JOB_NAME", { default: "ada-executor" });

/**
 * The currently-approved automatic-execution Codex model and reasoning effort — ADA runtime/control
 * -plane configuration, not user task data (see `adaCodexModelPolicy.ts` for the allow-lists and
 * validation). Deliberately no `default` for `ADA_CODEX_MODEL`: an unset value must resolve to `""`
 * at runtime and fail closed in `parseAdaCodexModelConfig`, not silently fall back to any model.
 * `ADA_CODEX_REASONING_EFFORT` defaults to `""`, which `parseAdaCodexModelConfig` treats as "not
 * configured" and omits — matching the executor's own optional `CODEX_REASONING_EFFORT` contract.
 */
export const adaCodexModel = defineString("ADA_CODEX_MODEL");
export const adaCodexReasoningEffort = defineString("ADA_CODEX_REASONING_EFFORT", { default: "" });
