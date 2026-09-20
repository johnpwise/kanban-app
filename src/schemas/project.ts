import { z } from "zod";

export const projectIdSchema = z
  .string()
  .min(1, "Project id is required.")
  .refine((value) => new TextEncoder().encode(value).length <= 1_500, "Project id is too long.")
  .refine((value) => value !== "." && value !== ".." && !value.includes("/"), "Project id is invalid.");

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a project name.")
  .max(80, "Project names must be 80 characters or fewer.");

export const githubRepositorySchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/,
    "Enter the repository as owner/repository, e.g. johnpwise/kanban-app.",
  );

export const defaultBranchSchema = z
  .string()
  .trim()
  .min(1, "Enter a default branch.")
  .max(255, "Branch names must be 255 characters or fewer.")
  .regex(/^\S+$/, "Branch names cannot contain spaces.");

export const projectSchema = z.object({
  id: projectIdSchema,
  name: projectNameSchema,
  repository: githubRepositorySchema,
  defaultBranch: defaultBranchSchema,
  createdAt: z.iso.datetime(),
});

export const createProjectRequestSchema = z.object({
  name: projectNameSchema,
  repository: githubRepositorySchema,
  defaultBranch: defaultBranchSchema,
});

export type Project = z.infer<typeof projectSchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
