import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";

// Field-level rules intentionally duplicated (not imported) from `functions/src/schemas/
// executionRunDocument.ts` / `executionRequestDocument.ts` / `dispatchMessage.ts`. `executor/` is
// a standalone deployable (its own Docker build context) with its own node_modules; importing
// across the package boundary would either pull `functions/` source into the executor's image or
// require a shared package — both are more restructuring than these few stable, rarely-changed
// rules justify. See plan Decision 3 (.agent-workflows/ada-cloud-run-executor-shell).
const DISPATCH_SCHEMA_VERSION = 1 as const;
const DISPATCH_EVENT_TYPE = "ada.execution.requested" as const;

const projectIdSchema = z
  .string()
  .min(1, "Project id is required.")
  .refine((value) => new TextEncoder().encode(value).length <= 1_500, "Project id is too long.")
  .refine((value) => value !== "." && value !== ".." && !value.includes("/"), "Project id is invalid.");

const githubRepositorySchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/,
    "Enter the repository as owner/repository, e.g. johnpwise/kanban-app.",
  );

const defaultBranchSchema = z
  .string()
  .trim()
  .min(1, "Enter a default branch.")
  .max(255, "Branch names must be 255 characters or fewer.")
  .regex(/^\S+$/, "Branch names cannot contain spaces.");

/**
 * The validated immutable execution intent snapshot. Read-only for this increment — the executor
 * never reconstructs this from mutable Project/Card data.
 */
const executionRunInputSchema = z.object({
  schemaVersion: z.literal(DISPATCH_SCHEMA_VERSION),
  eventType: z.literal(DISPATCH_EVENT_TYPE),
  title: z.string().min(1),
  prompt: z.string(),
  repository: githubRepositorySchema,
  baseBranch: defaultBranchSchema,
  requestedBy: z.string().min(1),
  requestedAt: z.iso.datetime(),
});

/** The durable ownership marker written by a winning atomic claim (see `executionRunRepository.ts`). */
const executionRunClaimSchema = z.object({
  claimId: z.string().min(1),
  claimedAt: z.instanceof(Timestamp),
});

/**
 * The durable source-provenance record written by the winning executor after a successful
 * repository checkout (see `executionRunRepository.ts`'s `recordSourceRevision`). Executor-only,
 * like `claim` — not modelled on the Functions side.
 */
const executionRunSourceRevisionSchema = z.object({
  headSha: z.string().min(1),
  resolvedAt: z.instanceof(Timestamp),
});

const executionRunDeliveryPullRequestSchema = z.object({
  number: z.number(),
  htmlUrl: z.string(),
});

/**
 * The durable, independently-verified delivery record written by `recordDelivery` once ADA's
 * GitHub push is confirmed (see `executionRunRepository.ts`). Executor-only, like `claim` /
 * `sourceRevision` — not modelled on the Functions side.
 */
const executionRunDeliverySchema = z.object({
  branch: z.string().min(1),
  commitSha: z.string().min(1),
  recordedAt: z.instanceof(Timestamp),
  pullRequest: executionRunDeliveryPullRequestSchema.optional(),
});

/** Shape of an `executionRuns/{executionRequestId}` Firestore document's data. */
const executionRunDocumentSchema = z.object({
  executionRequestId: z.string().min(1),
  correlationId: z.string().min(1),
  projectId: projectIdSchema,
  cardId: z.string().min(1),
  status: z.literal("accepted"),
  acceptedAt: z.instanceof(Timestamp),
  firstMessageId: z.string().min(1).optional(),
  input: executionRunInputSchema,
  claim: executionRunClaimSchema.optional(),
  sourceRevision: executionRunSourceRevisionSchema.optional(),
  delivery: executionRunDeliverySchema.optional(),
});

export type ExecutionRunInput = z.infer<typeof executionRunInputSchema>;
export type ExecutionRunDocument = z.infer<typeof executionRunDocumentSchema>;

export class ExecutionRunValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionRunValidationError";
  }
}

/**
 * Validates a Firestore `executionRuns/{documentId}` document's data and confirms the document ID
 * (the deduplication/idempotency key) agrees with the body's `executionRequestId` — an identifier
 * embedded only in the body is never trusted on its own.
 */
export function parseExecutionRunDocument(documentId: string, data: unknown): ExecutionRunDocument {
  const parsed = executionRunDocumentSchema.parse(data);
  if (parsed.executionRequestId !== documentId) {
    throw new ExecutionRunValidationError(
      "Execution run document ID does not match its executionRequestId field.",
    );
  }
  return parsed;
}
