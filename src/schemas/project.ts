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

export const projectSchema = z.object({
  id: projectIdSchema,
  name: projectNameSchema,
  createdAt: z.iso.datetime(),
});

export type Project = z.infer<typeof projectSchema>;
