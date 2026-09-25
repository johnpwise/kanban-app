import { z } from "zod";

const githubRepositorySchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/,
    "Enter the repository as owner/repository, e.g. johnpwise/kanban-app.",
  );

const branchNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a branch name.")
  .max(255, "Branch names must be 255 characters or fewer.")
  .regex(/^\S+$/, "Branch names cannot contain spaces.");

/**
 * The environment is an untrusted runtime boundary, same as `config.ts`'s own docstring — but this
 * is a deliberately separate schema/module, not an extension of `ExecutorConfig`: unlike the
 * merge/CI controllers (which resolve `repository`/`baseBranch` from the persisted `executionRuns`
 * document), the release controller's trusted `repository`/`sourceBranch` are never present on any
 * document the caller can influence before this controller runs — they must be this Job's own
 * deploy-time configuration (see `executor/deploy/deploy.sh`'s `deploy-release-controller-job`),
 * independent of whatever repository/branch the Firebase launcher itself was configured with.
 */
const releaseControllerConfigSchema = z.object({
  releaseIntentId: z
    .string()
    .min(1, "ADA_RELEASE_INTENT_ID is required.")
    .trim()
    .min(1, "ADA_RELEASE_INTENT_ID cannot be blank.")
    .refine((value) => value !== "." && value !== ".." && !value.includes("/"), {
      message: "ADA_RELEASE_INTENT_ID is not a valid Firestore document ID.",
    }),
  repository: githubRepositorySchema,
  sourceBranch: branchNameSchema,
});

export type ReleaseControllerConfig = z.infer<typeof releaseControllerConfigSchema>;

export function parseReleaseControllerConfig(env: Record<string, string | undefined>): ReleaseControllerConfig {
  return releaseControllerConfigSchema.parse({
    releaseIntentId: env.ADA_RELEASE_INTENT_ID,
    repository: env.ADA_RELEASE_REPOSITORY,
    sourceBranch: env.ADA_RELEASE_SOURCE_BRANCH,
  });
}
