"use server";

import { deleteCard } from "@/lib/services/board";
import { deleteCardRequestSchema } from "@/schemas/board";
import { projectIdSchema } from "@/schemas/project";

import type { Board } from "@/schemas/board";

export interface DeleteCardActionState {
  status: "idle" | "success" | "error";
  board?: Board;
  message?: string;
}

export async function deleteCardAction(
  _previousState: DeleteCardActionState,
  projectId: unknown,
  request: unknown,
): Promise<DeleteCardActionState> {
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  const parsed = deleteCardRequestSchema.safeParse(request);

  if (!parsedProjectId.success) {
    return { status: "error", message: "Invalid project." };
  }

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid delete request.",
    };
  }

  try {
    const board = await deleteCard(parsedProjectId.data, parsed.data);

    return { status: "success", board };
  } catch (error) {
    console.error("Failed to delete card.", error);
    return {
      status: "error",
      message: "Could not delete the card. Please try again.",
    };
  }
}
