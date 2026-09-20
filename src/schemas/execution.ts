import { z } from "zod";

import { defaultBranchSchema, githubRepositorySchema, projectIdSchema } from "./project";

export const cardIdSchema = z.string().min(1);

export const executionRequestSchema = z.object({
  id: z.string().min(1),
  projectId: projectIdSchema,
  cardId: cardIdSchema,
  title: z.string().min(1),
  prompt: z.string(),
  repository: githubRepositorySchema,
  baseBranch: defaultBranchSchema,
  requestedBy: z.string().min(1),
  requestedAt: z.iso.datetime(),
});

export const requestExecutionInputSchema = z.object({
  projectId: projectIdSchema,
  cardId: cardIdSchema,
  requestedBy: z.string().min(1),
});

export type ExecutionRequest = z.infer<typeof executionRequestSchema>;
export type RequestExecutionInput = z.infer<typeof requestExecutionInputSchema>;
