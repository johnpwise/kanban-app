import { z } from "zod";

const githubRepositorySchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/,
    "Enter the repository as owner/repository, e.g. johnpwise/kanban-app.",
  );

/**
 * A deliberately separate schema/module from `releasePullRequestControllerConfig.ts`, mirroring
 * that file's own documented rationale: this stage's trusted `repository` is this Job's own
 * deploy-time configuration (see `executor/deploy/deploy.sh`), independent of whatever repository
 * any other controller's own deploy-time config carries, even though all of them are named
 * `ADA_RELEASE_REPOSITORY`. `repository` is validated here for deploy-time consistency with every
 * sibling release-stage Cloud Run Job (`executor/deploy/deploy.sh` sets `ADA_RELEASE_REPOSITORY`
 * uniformly across all of them) even though this stage's own logic never branches on the parsed
 * value: `observeReleaseCiForReleasePullRequest` (PR #66) derives its trusted `repository` solely
 * from the persisted release intent, never from a caller-supplied value — a malformed
 * `ADA_RELEASE_REPOSITORY` still fails this Job closed at startup rather than deploying silently
 * misconfigured.
 */
const releaseCiControllerConfigSchema = z.object({
  releaseIntentId: z
    .string()
    .min(1, "ADA_RELEASE_INTENT_ID is required.")
    .trim()
    .min(1, "ADA_RELEASE_INTENT_ID cannot be blank.")
    .refine((value) => value !== "." && value !== ".." && !value.includes("/"), {
      message: "ADA_RELEASE_INTENT_ID is not a valid Firestore document ID.",
    }),
  repository: githubRepositorySchema,
});

export type ReleaseCiControllerConfig = z.infer<typeof releaseCiControllerConfigSchema>;

export function parseReleaseCiControllerConfig(env: Record<string, string | undefined>): ReleaseCiControllerConfig {
  return releaseCiControllerConfigSchema.parse({
    releaseIntentId: env.ADA_RELEASE_INTENT_ID,
    repository: env.ADA_RELEASE_REPOSITORY,
  });
}
