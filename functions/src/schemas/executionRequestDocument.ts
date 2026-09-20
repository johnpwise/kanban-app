import { z } from "zod";

// Field-level rules intentionally duplicated (not imported) from the Next.js app's
// src/schemas/project.ts / src/schemas/execution.ts. `functions/` is a standalone deploy
// artifact with its own node_modules; importing across the package boundary would either pull
// app code into the Functions bundle or require a shared package — both are more restructuring
// than these few stable, rarely-changed regexes justify. See plan Decision 4.
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
 * Shape of an `executionRequests/{id}` Firestore document's data, once its `requestedAt`
 * Firestore Timestamp has been converted to an ISO-8601 string. Does not include the document
 * ID itself — Firestore document data never contains its own ID.
 */
export const executionRequestDocumentDataSchema = z.object({
  projectId: projectIdSchema,
  cardId: z.string().min(1),
  title: z.string().min(1),
  prompt: z.string(),
  repository: githubRepositorySchema,
  baseBranch: defaultBranchSchema,
  requestedBy: z.string().min(1),
  requestedAt: z.iso.datetime(),
});

export type ExecutionRequestDocumentData = z.infer<typeof executionRequestDocumentDataSchema>;
