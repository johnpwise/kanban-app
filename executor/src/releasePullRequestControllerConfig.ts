import { z } from "zod";

const githubRepositorySchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/,
    "Enter the repository as owner/repository, e.g. johnpwise/kanban-app.",
  );

/**
 * The environment is an untrusted runtime boundary, same as `releaseControllerConfig.ts`'s own
 * docstring — but this is a deliberately separate schema/module, not an extension of
 * `ReleaseControllerConfig`: this stage's trusted `repository` is this Job's own deploy-time
 * configuration (see `executor/deploy/deploy.sh`), independent of whatever repository the
 * release-start controller's own deploy-time config carries, even though both are named
 * `ADA_RELEASE_REPOSITORY`. Unlike `releaseControllerConfig.ts`, no `sourceBranch` is needed here:
 * this stage never re-checks the source branch, only the already-durable release branch/start
 * result.
 */
const releasePullRequestControllerConfigSchema = z.object({
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

export type ReleasePullRequestControllerConfig = z.infer<typeof releasePullRequestControllerConfigSchema>;

export function parseReleasePullRequestControllerConfig(env: Record<string, string | undefined>): ReleasePullRequestControllerConfig {
  return releasePullRequestControllerConfigSchema.parse({
    releaseIntentId: env.ADA_RELEASE_INTENT_ID,
    repository: env.ADA_RELEASE_REPOSITORY,
  });
}
