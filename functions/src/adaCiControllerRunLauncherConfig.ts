import { defineString } from "firebase-functions/params";

/**
 * Cloud Run Job name for the `ada-ci-controller` launcher. Deliberately a separate Job from
 * `ada-executor` (see `adaExecutorRunLauncherConfig.ts`) — the CI controller is a distinct,
 * asynchronous lifecycle stage with no Codex configuration of its own. Project and region are
 * shared with the executor launcher (`adaGcpProjectId`/`adaGcpRegion`): both Jobs live in the same
 * single production-equivalent project/database, so a second pair of params would only duplicate
 * the same values under a different name.
 */
export const adaCiJobName = defineString("ADA_CI_JOB_NAME", { default: "ada-ci-controller" });
