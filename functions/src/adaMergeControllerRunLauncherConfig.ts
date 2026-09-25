import { defineString } from "firebase-functions/params";

/**
 * Cloud Run Job name for the `ada-merge-controller` launcher. Deliberately a separate Job from
 * both `ada-executor` and `ada-ci-controller` (see `adaExecutorRunLauncherConfig.ts` /
 * `adaCiControllerRunLauncherConfig.ts`) — the merge controller is a distinct, asynchronous
 * lifecycle stage with no Codex configuration of its own. Project and region are shared with the
 * other launchers (`adaGcpProjectId`/`adaGcpRegion`): all Jobs live in the same single
 * production-equivalent project/database, so a second pair of params would only duplicate the
 * same values under a different name.
 */
export const adaMergeJobName = defineString("ADA_MERGE_JOB_NAME", { default: "ada-merge-controller" });
