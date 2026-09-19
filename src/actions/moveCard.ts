"use server";

import { moveCard } from "@/lib/services/board";
import { getCurrentUser } from "@/lib/services/session";
import { moveCardRequestSchema } from "@/schemas/board";
import { projectIdSchema } from "@/schemas/project";

import type { Board } from "@/schemas/board";

export interface MoveCardActionState {
  status: "idle" | "success" | "error";
  board?: Board;
  message?: string;
}

export async function moveCardAction(
  _previousState: MoveCardActionState,
  projectId: unknown,
  request: unknown,
): Promise<MoveCardActionState> {
  const user = await getCurrentUser();

  if (!user) {
    return { status: "error", message: "You must be signed in to move a card." };
  }

  const parsedProjectId = projectIdSchema.safeParse(projectId);
  const parsed = moveCardRequestSchema.safeParse(request);

  if (!parsedProjectId.success) {
    return { status: "error", message: "Invalid project." };
  }

  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Invalid move request.",
    };
  }

  try {
    const board = await moveCard(parsedProjectId.data, parsed.data);

    return { status: "success", board };
  } catch (error) {
    console.error("Failed to move card.", error);
    return {
      status: "error",
      message: "Could not move the card. Please try again.",
    };
  }
}
