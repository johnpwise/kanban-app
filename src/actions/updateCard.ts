"use server";

import { updateCard } from "@/lib/services/board";
import { updateCardRequestSchema } from "@/schemas/board";
import { projectIdSchema } from "@/schemas/project";

import type { Board } from "@/schemas/board";

export interface UpdateCardActionState {
  status: "idle" | "success" | "error";
  board?: Board;
  message?: string;
}

export async function updateCardAction(
  _previousState: UpdateCardActionState,
  projectId: unknown,
  request: unknown,
): Promise<UpdateCardActionState> {
  const parsedProjectId = projectIdSchema.safeParse(projectId);
  const parsed = updateCardRequestSchema.safeParse(request);

  if (!parsedProjectId.success) {
    return { status: "error", message: "Invalid project." };
  }

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid update request.",
    };
  }

  try {
    const board = await updateCard(parsedProjectId.data, parsed.data);

    return { status: "success", board };
  } catch (error) {
    console.error("Failed to update card.", error);
    return {
      status: "error",
      message: "Could not update the card. Please try again.",
    };
  }
}
