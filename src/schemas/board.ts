import { z } from "zod";

export const cardLabelSchema = z.enum(["bug", "feature", "chore"]);

export const executionStatusSchema = z.enum([
  "not_started",
  "queued",
  "planning",
  "implementing",
  "testing",
  "creating_pr",
  "completed",
  "failed",
  "cancelled",
]);

export const cardSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  label: cardLabelSchema.nullable(),
  createdAt: z.string(),
  notes: z.string().nullable(),
  dueDate: z.string().nullable(),
  prompt: z.string(),
  executionStatus: executionStatusSchema,
  createdBy: z.string().min(1),
  updatedAt: z.string(),
});

export const columnSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  cardIds: z.array(z.string().min(1)),
});

export const boardSchema = z.object({
  columns: z.array(columnSchema),
  cardsById: z.record(z.string(), cardSchema),
});

export const moveCardRequestSchema = z.object({
  cardId: z.string().min(1),
  toColumnId: z.string().min(1),
  toIndex: z.number().int().min(0),
});

export const addCardRequestSchema = z.object({
  cardId: z.string().min(1),
  columnId: z.string().min(1),
  title: z.string().min(1).max(200),
  label: cardLabelSchema.nullable(),
  prompt: z.string().min(1),
});

export const deleteCardRequestSchema = z.object({
  cardId: z.string().min(1),
});

export const updateCardRequestSchema = z.object({
  cardId: z.string().min(1),
  notes: z.string(),
  dueDate: z.string().nullable(),
});

export type CardLabel = z.infer<typeof cardLabelSchema>;
export type ExecutionStatus = z.infer<typeof executionStatusSchema>;
export type Card = z.infer<typeof cardSchema>;
export type Column = z.infer<typeof columnSchema>;
export type Board = z.infer<typeof boardSchema>;
export type MoveCardRequest = z.infer<typeof moveCardRequestSchema>;
export type AddCardRequest = z.infer<typeof addCardRequestSchema>;
export type DeleteCardRequest = z.infer<typeof deleteCardRequestSchema>;
export type UpdateCardRequest = z.infer<typeof updateCardRequestSchema>;
