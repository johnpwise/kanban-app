import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

const PLAIN_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

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
 * Plain `MAJOR.MINOR.PATCH` only — no leading `v`, no prerelease suffix, no build metadata. Matches
 * the version-format rule already established by the `start-release` skill; re-expressed here (not
 * imported) since `executor/` is a standalone deployable with its own `node_modules` and the skill
 * is a prose workflow, not importable code — same reasoning `runExecutor.ts` already records for
 * its own duplicated field rules.
 */
export const releaseVersionSchema = z
  .string()
  .trim()
  .regex(
    PLAIN_SEMVER_PATTERN,
    "Version must be plain MAJOR.MINOR.PATCH, with no leading v, prerelease suffix, or build metadata.",
  );

const commitShaSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-f]{40}$/i, "Expected a full 40-character commit SHA.");

/**
 * The durably-recorded result of a successfully completed (or safely reconciled) guarded
 * release-start mutation — present only once `releaseIntentRepository.ts`'s
 * `recordReleaseStartResult` has recorded one. Immutable once set.
 */
const releaseStartResultSchema = z.object({
  releaseBranch: branchNameSchema,
  commitSha: commitShaSchema,
  recordedAt: z.instanceof(Timestamp),
});

/**
 * The durably-recorded result of a freshly-verified, guarded release Pull Request create/reuse for
 * one target (`main` or `develop`) — present only once `releaseIntentRepository.ts`'s
 * `recordReleasePullRequestResult` has recorded one for that target. `headBranch`/`headSha` are
 * always the trusted `start.releaseBranch`/`start.commitSha` at the time of recording — never an
 * independently caller-supplied value — so a persisted result can never drift from the release
 * commit it evidences. Immutable once set.
 */
const releasePullRequestResultSchema = z.object({
  number: z.number(),
  baseBranch: branchNameSchema,
  headBranch: branchNameSchema,
  headSha: commitShaSchema,
  recordedAt: z.instanceof(Timestamp),
});

/**
 * The durably-recorded, immutable terminal CI evidence for one release Pull Request target (`main`
 * or `develop`) — present only once `releaseIntentRepository.ts`'s `recordReleaseCiResult` has
 * recorded one for that target. Self-contained: `number`/`headBranch`/`headSha` are snapshotted
 * from the already-trusted, already-immutable `pullRequests.{target}` record at the moment CI was
 * durably recorded (never independently caller-supplied), so this evidence alone is sufficient to
 * distinguish one target's CI from the other, one PR from another, and one head SHA from another —
 * without a reader needing to cross-reference `pullRequests.{target}` separately. Immutable once
 * set: `state`/`runId`/`htmlUrl`/`conclusion` are never overwritten once recorded, even by a later
 * GitHub Actions rerun of the same `runId` (see `recordReleaseCiResult`'s conflict contract).
 */
const releaseCiResultSchema = z.object({
  number: z.number(),
  baseBranch: branchNameSchema,
  headBranch: branchNameSchema,
  headSha: commitShaSchema,
  state: z.enum(["succeeded", "failed"]),
  runId: z.number(),
  htmlUrl: z.string(),
  conclusion: z.string().min(1).optional(),
  recordedAt: z.instanceof(Timestamp),
});

/**
 * The durably-recorded, immutable evidence that a release Pull Request for one target (`main` or
 * `develop`) was safely merged — present only once `releaseIntentRepository.ts`'s
 * `recordReleaseMergeResult` has recorded one for that target. Self-contained like
 * `releaseCiResultSchema`: `number`/`baseBranch`/`headBranch`/`headSha` are snapshotted from the
 * already-immutable, already-persisted `pullRequests.{target}` record at the moment the merge was
 * durably recorded (never independently caller-supplied) — the only genuinely new externally
 * observed identity is `mergeCommitSha`, GitHub's own record of the merge commit it created.
 * Immutable once set: a merge record must never silently change to a different `mergeCommitSha`.
 */
const releaseMergeResultSchema = z.object({
  number: z.number(),
  baseBranch: branchNameSchema,
  headBranch: branchNameSchema,
  headSha: commitShaSchema,
  mergeCommitSha: commitShaSchema,
  recordedAt: z.instanceof(Timestamp),
});

/** Shape of a `releaseIntents/{releaseIntentId}` Firestore document's data. */
export const releaseIntentDocumentSchema = z.object({
  releaseIntentId: z.string().min(1),
  repository: githubRepositorySchema,
  version: releaseVersionSchema,
  sourceBranch: branchNameSchema,
  sourceRevision: commitShaSchema,
  requestedAt: z.instanceof(Timestamp),
  start: releaseStartResultSchema.optional(),
  pullRequests: z
    .object({
      main: releasePullRequestResultSchema.optional(),
      develop: releasePullRequestResultSchema.optional(),
    })
    .optional(),
  ci: z
    .object({
      main: releaseCiResultSchema.optional(),
      develop: releaseCiResultSchema.optional(),
    })
    .optional(),
  merges: z
    .object({
      main: releaseMergeResultSchema.optional(),
      develop: releaseMergeResultSchema.optional(),
    })
    .optional(),
});

export type ReleaseIntentDocument = z.infer<typeof releaseIntentDocumentSchema>;

/** The two trusted intended base branches for a release's Pull Requests — never caller-selected. */
export type ReleasePullRequestTarget = "main" | "develop";

export class ReleaseIntentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseIntentValidationError";
  }
}

/**
 * Validates a Firestore `releaseIntents/{documentId}` document's data and confirms the document ID
 * (the natural-key/idempotency identity) agrees with the body's `releaseIntentId` — an identifier
 * embedded only in the body is never trusted on its own. Mirrors
 * `executor/src/schemas/executionRunDocument.ts`'s `parseExecutionRunDocument`.
 */
export function parseReleaseIntentDocument(documentId: string, data: unknown): ReleaseIntentDocument {
  const parsed = releaseIntentDocumentSchema.parse(data);
  if (parsed.releaseIntentId !== documentId) {
    throw new ReleaseIntentValidationError("Release intent document ID does not match its releaseIntentId field.");
  }
  return parsed;
}

/**
 * Firestore document ids cannot contain `/`; `repository` is always `owner/repo`. The natural key
 * for a release intent is `(repository, version)` — re-requesting the same key with a different
 * `sourceBranch`/`sourceRevision` is a conflict for `releaseIntentRepository.ts` to detect, not a
 * silent overwrite.
 */
export function deriveReleaseIntentId(repository: string, version: string): string {
  return `${repository.replace("/", "__")}--${version}`;
}

/**
 * The reverse of `deriveReleaseIntentId`, used by `releaseControllerMain.ts` to recover the
 * caller-supplied `version` from a trusted `releaseIntentId` it was given (the Firebase launcher
 * passes only `releaseIntentId`, never a separate `version` field). Fails closed to `undefined`
 * rather than guessing: if `releaseIntentId` does not start with the exact prefix derived from the
 * trusted `repository`, or the remainder is not a valid `releaseVersionSchema` version, the caller
 * must never proceed as if a version had been resolved.
 */
export function deriveReleaseVersionFromIntentId(releaseIntentId: string, repository: string): string | undefined {
  const prefix = `${deriveReleaseIntentId(repository, "")}`;
  if (!releaseIntentId.startsWith(prefix)) {
    return undefined;
  }
  const candidate = releaseIntentId.slice(prefix.length);
  return releaseVersionSchema.safeParse(candidate).success ? candidate : undefined;
}

/**
 * Strict greater-than by plain `MAJOR.MINOR.PATCH` precedence. Callers must validate both inputs
 * against `releaseVersionSchema` first — this comparator does no format checking of its own so a
 * malformed live-observed "current version" can be reported as its own distinct eligibility
 * failure rather than silently comparing as `NaN`.
 */
export function isReleaseVersionGreaterThan(candidateVersion: string, currentVersion: string): boolean {
  const candidate = candidateVersion.split(".").map(Number);
  const current = currentVersion.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (candidate[index] !== current[index]) {
      return candidate[index] > current[index];
    }
  }
  return false;
}
