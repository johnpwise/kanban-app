import { defineString } from "firebase-functions/params";

/**
 * Cloud Run Job name for the `ada-release-ci-controller` launcher. Deliberately a separate Job
 * from `ada-executor`/`ada-ci-controller`/`ada-merge-controller`/`ada-release-controller`/
 * `ada-release-pr-controller` (see those launchers' own `*RunLauncherConfig.ts` files) — the
 * release-ci controller is a distinct lifecycle stage with no Codex configuration of its own.
 * Project and region are shared with the other launchers (`adaGcpProjectId`/`adaGcpRegion`).
 */
export const adaReleaseCiJobName = defineString("ADA_RELEASE_CI_JOB_NAME", {
  default: "ada-release-ci-controller",
});
