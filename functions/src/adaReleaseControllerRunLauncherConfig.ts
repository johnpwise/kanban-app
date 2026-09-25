import { defineString } from "firebase-functions/params";

/**
 * Cloud Run Job name for the `ada-release-controller` launcher. Deliberately a separate Job from
 * `ada-executor`/`ada-ci-controller`/`ada-merge-controller` (see those launchers' own
 * `*RunLauncherConfig.ts` files) — the release controller is a distinct, explicitly-triggered
 * lifecycle, not part of the automatic delivery pipeline. Project and region are shared with the
 * other launchers (`adaGcpProjectId`/`adaGcpRegion`).
 */
export const adaReleaseJobName = defineString("ADA_RELEASE_JOB_NAME", { default: "ada-release-controller" });

/**
 * The trusted repository this launcher derives `releaseIntentId` from (see `launchReleaseStart.ts`).
 * Deliberately no default: an unconfigured value must fail closed rather than silently deriving a
 * `releaseIntentId` against a guessed repository. Independently configured from the
 * `ada-release-controller` Job's own `ADA_RELEASE_REPOSITORY` (see `executor/deploy/deploy.sh`) —
 * the two must agree, but neither is derived from the other, mirroring the defense-in-depth
 * "expected*, never hardcoded, supplied by the caller" pattern `evaluateReleaseEligibility` already
 * uses.
 */
export const adaReleaseRepository = defineString("ADA_RELEASE_REPOSITORY");
