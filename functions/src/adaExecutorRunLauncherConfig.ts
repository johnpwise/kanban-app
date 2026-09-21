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
